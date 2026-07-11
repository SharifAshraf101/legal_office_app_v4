import type { Case, Client, DocumentRecord, Lang, TimelineItem } from '@/types';

export interface CaseNoteEntry {
  id: string;
  /** Where the note came from — drives the icon in the notes tab. */
  source: 'note' | 'client' | 'document';
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
 *   • the notes typed when a document was uploaded (the document's description).
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
