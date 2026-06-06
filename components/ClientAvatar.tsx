'use client';

import { useRef, useState } from 'react';
import type { Client } from '@/types';
import { clientDisplayName } from '@/lib/clients';
import { useT } from '@/hooks/useT';
import { useAppState } from '@/hooks/useAppState';
import { uploadClientPhotoToStorage } from '@/lib/cloudflare';

/**
 * Avatar + photo upload. Placeholder text "תמונה" / "صورة" replaces
 * the legacy initials display when no photo is set. Clicking the
 * avatar opens a file picker; after the user picks an image we
 * upload it to Supabase Storage and persist the returned public URL
 * onto the client's `photoUrl` field via app-state dispatch (which
 * also triggers the autosave-to-Supabase pipeline on the clients
 * table). No more manual save/cancel — the picture is committed
 * automatically the moment the upload succeeds.
 */
export interface ClientAvatarProps {
  client: Client;
  editable?: boolean;
}

export function ClientAvatar({ client, editable = false }: ClientAvatarProps) {
  const { state, dispatch } = useAppState();
  const { lang } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  const display = clientDisplayName(client, lang);
  // Placeholder text shown when there is no photo yet. Replaces the
  // legacy initials per user request.
  const placeholderText = lang === 'ar' ? 'صورة' : 'תמונה';

  const onPick = () => {
    if (!editable || uploading) return;
    fileRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 1. Show an instant local preview (data URL) so the user sees
    //    the picture immediately while the Supabase upload runs.
    const reader = new FileReader();
    reader.onload = () => setLocalPreview(String(reader.result || ''));
    reader.readAsDataURL(file);

    // 2. Upload the file to Supabase Storage and get a public URL.
    setUploading(true);
    const publicUrl = await uploadClientPhotoToStorage(file, client.id);
    setUploading(false);

    // 3. Persist the URL (or the data URL fallback) on the client
    //    record. The reducer's SET_CLIENTS dispatch updates the
    //    autosave-to-Supabase pipeline so the `clients` row gets
    //    its `photo_url` column written too.
    const finalUrl = publicUrl || (await fileToDataUrl(file));
    const updated = state.clients.map((c) =>
      c.id === client.id ? { ...c, photoUrl: finalUrl } : c,
    );
    dispatch({ type: 'SET_CLIENTS', clients: updated });
    setLocalPreview(null);
    // Reset the input so picking the same file again still fires
    // the onChange.
    if (fileRef.current) fileRef.current.value = '';
  };

  // Effective image source: live preview > saved client.photoUrl.
  const imgSrc = localPreview || client.photoUrl || '';

  return (
    <div id={`clientPhotoPreview_${client.id}`}>
      <div
        className={'client-avatar' + (editable ? ' editable' : '')}
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        onClick={onPick}
        aria-label={editable ? placeholderText : display}
      >
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgSrc} alt={display} />
        ) : (
          // Placeholder text shown ONLY when there's no photo;
          // disappears the moment a picture is chosen (the <img>
          // branch above renders instead).
          <span className="client-avatar-placeholder">{placeholderText}</span>
        )}
      </div>
      {editable && (
        <input
          ref={fileRef}
          id={`clientPhotoInput_${client.id}`}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onFile}
        />
      )}
    </div>
  );
}

/** Small helper: read a File as data URL, used as a fallback when
 *  the Supabase Storage upload fails (so the user at least sees the
 *  picture saved locally / in the clients table as base64). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
