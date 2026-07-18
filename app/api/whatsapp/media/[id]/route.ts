import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Proxy a WhatsApp media object (image / document / audio / video) by its Meta
// media id. The raw Graph media URL requires the app's bearer token AND is
// short-lived, so the browser can never load it directly — we resolve the id to
// a temporary URL server-side, fetch the bytes with the token, and stream them
// back from our own origin. That lets the WhatsApp chat both PREVIEW an image
// inline (<img src>) and DOWNLOAD it (a same-origin <a download> keeps the
// filename), and makes the "open document" button work for received files too.
//
// Note: WhatsApp only retains media for a limited window (~30 days). Once Meta
// drops it the lookup 404s — the caller shows a "media unavailable" state.

const GRAPH_VERSION = 'v19.0';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'whatsapp_not_configured' },
      { status: 500 },
    );
  }
  // The media id is a numeric string from Meta; reject anything else so this
  // can't be turned into an arbitrary Graph API proxy.
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'bad_media_id' }, { status: 400 });
  }

  try {
    // 1 — Resolve the media id to a temporary, token-gated download URL.
    const metaRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metaRes.ok) {
      // 404 here usually means Meta has aged the media out.
      return NextResponse.json(
        { error: 'media_lookup_failed' },
        { status: metaRes.status === 404 ? 404 : 502 },
      );
    }
    const meta = (await metaRes.json()) as {
      url?: string;
      mime_type?: string;
    };
    if (!meta.url) {
      return NextResponse.json({ error: 'media_url_missing' }, { status: 404 });
    }

    // 2 — Fetch the actual bytes (the CDN URL also requires the bearer token).
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!fileRes.ok || !fileRes.body) {
      return NextResponse.json(
        { error: 'media_fetch_failed' },
        { status: 502 },
      );
    }

    const contentType =
      meta.mime_type ||
      fileRes.headers.get('content-type') ||
      'application/octet-stream';

    // Stream the bytes straight through — no need to buffer the whole file.
    return new NextResponse(fileRes.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // Private so it isn't shared-cached; a day is plenty for repeat views
        // within a chat session while the media still exists on Meta.
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (e) {
    console.error('[WhatsApp media] proxy failed', e);
    return NextResponse.json({ error: 'proxy_error' }, { status: 502 });
  }
}
