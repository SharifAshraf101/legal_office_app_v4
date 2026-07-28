import type { Case, Client, DocumentRecord, Lang, TimelineItem } from '@/types';

export interface CaseNoteEntry {
  id: string;
  /** Where the note came from — drives the icon in the notes tab. */
  source: 'note' | 'client' | 'document' | 'summary';
  /** Bold heading of the note card (e.g. "הערת לקוח" or the doc name). */
  label: string;
  /** Body text of the note. */
  body: string;
  /** Display date (may be empty). */
  date: string;
  /** Flat text used to feed the AI draft. */
  text: string;
}

/**
 * All notes attached to a case, gathered from every place the office can add
 * one, so the case-brain "הערות" tab AND the reply-draft AI see the same set:
 *   • quick-action / timeline notes (type 'note') added in the brain,
 *   • the client's own notes (from the client-details screen),
 *   • the notes typed when a document was uploaded (the document's description),
 *   • the AI-generated SUMMARY of each document (summaryHe/summaryAr) — copied
 *     in so the notes tab shows every document's gist AND the reply-draft AI
 *     reads it, not only the single document it is drafting a reply for.
 * Newest first. Language-aware (prefers the field matching `lang`).
 */
export function aggregateCaseNotes(opts: {
  caseId: string;
  clients: Client[];
  cases: Case[];
  documents: DocumentRecord[];
  timeline: TimelineItem[];
  lang: Lang;
}): CaseNoteEntry[] {
  const { caseId, clients, cases, documents, timeline, lang } = opts;
  const pick = (he?: string, ar?: string) =>
    ((lang === 'ar' ? ar || he : he || ar) || '').trim();

  const caseObj = cases.find((c) => String(c.id) === String(caseId));
  const client = caseObj
    ? clients.find((cl) => cl.id === caseObj.clientId)
    : undefined;

  const clientNoteLabel = lang === 'ar' ? 'ملاحظة الموكل' : 'הערת לקוח';
  const docNoteLabel = lang === 'ar' ? 'ملاحظة على مستند' : 'הערה על מסמך';
  const docSummaryLabel = lang === 'ar' ? 'ملخص المستند' : 'תקציר המסמך';

  const entries: CaseNoteEntry[] = [];

  // 1. Timeline notes (quick actions in the brain).
  for (const n of timeline) {
    if (String(n.caseId) !== String(caseId) || String(n.type) !== 'note') continue;
    const label = pick(n.title, n.titleAr);
    const body = pick(n.description, n.descriptionAr);
    const combined = [label, body].filter(Boolean).join(' — ');
    if (!combined) continue;
    entries.push({
      id: String(n.id),
      source: 'note',
      label: label || (lang === 'ar' ? 'ملاحظة' : 'הערה'),
      body,
      date: String(n.date || ''),
      text: combined,
    });
  }

  // 2. The client's own note (from the client-details screen).
  const clientNote = pick(client?.notes, client?.notesAr);
  if (clientNote) {
    entries.push({
      id: 'client-note-' + (client?.id ?? ''),
      source: 'client',
      label: clientNoteLabel,
      body: clientNote,
      date: '',
      text: clientNoteLabel + ': ' + clientNote,
    });
  }

  // 3. Notes typed when a document was uploaded (the document's description).
  for (const d of documents) {
    if (String(d.caseId) !== String(caseId)) continue;
    const body = pick(d.description, d.descriptionAr);
    if (!body) continue;
    const name = (d.title || d.fileName || '').trim();
    entries.push({
      id: 'doc-note-' + String(d.id),
      source: 'document',
      label: docNoteLabel + (name ? ' — ' + name : ''),
      body,
      date: String(d.date || ''),
      text: (name ? name + ': ' : '') + body,
    });
  }

  // 4. The AI summary of each document (mirrored onto the row as
  //    summaryHe/summaryAr from the file_summary table). Copied into the notes
  //    so the "הערות" tab shows every document's gist and the reply-draft AI
  //    reads all of them — not only the one document it drafts a reply for.
  for (const d of documents) {
    if (String(d.caseId) !== String(caseId)) continue;
    const body = pick(d.summaryHe, d.summaryAr);
    if (!body) continue;
    const name = (d.title || d.fileName || '').trim();
    entries.push({
      id: 'doc-summary-' + String(d.id),
      source: 'summary',
      label: docSummaryLabel + (name ? ' — ' + name : ''),
      body,
      date: String(d.date || ''),
      text: (name ? name + ' — ' : '') + docSummaryLabel + ': ' + body,
    });
  }

  // Newest first (undated client note sorts last).
  entries.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return entries;
}

/** Flatten aggregated notes into the context string handed to the draft AI. */
export function caseNotesContext(entries: CaseNoteEntry[]): string {
  return entries
    .map((e) => e.text)
    .filter(Boolean)
    .join('\n\n');
}
