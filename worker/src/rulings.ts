// "פסיקת בית הדין השרעי" — the office's digest of Sharia Court of Appeals
// rulings, as a table in the CONTROL DB (shared by every office: it is
// reference law, not any office's data). Loaded from shariaRulingsData.ts on
// first use and reloaded when its version changes.
//
// Before a reply draft is written, relevantRulings() picks the topics the case
// is about (custody, alimony, housing, mahr / arbitration, jurisdiction,
// service, waqf) from the case title, court, document name and the case notes,
// and hands those sections to Claude to build the legal arguments on.

import type { Env } from './db';
import { SHARIA_RULINGS, SHARIA_RULINGS_VERSION } from './shariaRulingsData';

/** What marks a case as being about a topic — Hebrew + Arabic terms as they
 *  appear in case titles, court documents and the office's notes. */
const TOPIC_TERMS: Record<string, string[]> = {
  custody: ['משמורת', 'הסדרי ראייה', 'הסדרי שהות', 'זמני שהות', 'حضانة', 'الحضانة', 'مشاهدة', 'استضافة', 'المحضون', 'القاصر', 'مبيت'],
  alimony: ['מזונות', 'نفقة', 'النفقة', 'نشوز', 'ناشز', 'تمكين', 'الاحتباس'],
  housing: ['מדור', 'שכר דירה', 'דמי שכירות', 'ארנונה', 'سكن', 'مسكن', 'المسكن', 'أجرة', 'إيجار', 'أرنونا'],
  mahr: ['מוהר', 'מהר', 'מאוחר', 'مهر', 'المهر', 'مؤجل', 'معجل', 'شقاق', 'نزاع وشقاق', 'تفريق', 'خلع'],
  arbitration: ['שקאק', 'נזאע', 'בוררים', 'בורר', 'גירושין', 'פירוד', 'حكمين', 'الحكمين', 'تحكيم', 'التحكيم', 'شقاق', 'تفريق', 'طلاق'],
  jurisdiction: ['סמכות', 'כריכה', 'ענייני משפחה', 'בית המשפט לענייני משפחה', 'صلاحية', 'الصلاحية', 'اختصاص', 'شؤون الأسرة', 'شطب', 'تغيير الديانة'],
  service: ['המצאה', 'הומצא', 'ערעור', 'מועד', 'تبليغ', 'التبليغ', 'ناسوخ', 'فاكس', 'استئناف', 'الاستئناف'],
  waqf: ['ווקף', 'וקף', 'הקדש', 'وقف', 'الوقف', 'متولي', 'المتولي', 'أوقاف'],
};

const MAX_TOPICS = 3;
const MAX_CHARS = 16000;

async function ensureRulings(env: Env): Promise<void> {
  await env.CONTROL_DB.prepare(
    `CREATE TABLE IF NOT EXISTS sharia_rulings (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       topic_key TEXT NOT NULL,
       topic TEXT NOT NULL,
       section TEXT NOT NULL,
       rulings TEXT,
       content TEXT NOT NULL,
       version INTEGER NOT NULL
     )`,
  ).run();
  const v = await env.CONTROL_DB.prepare('SELECT MAX(version) AS v FROM sharia_rulings').first<{ v: number | null }>();
  if (Number(v?.v || 0) === SHARIA_RULINGS_VERSION) return;
  const stmts = [env.CONTROL_DB.prepare('DELETE FROM sharia_rulings')];
  for (const r of SHARIA_RULINGS) {
    stmts.push(
      env.CONTROL_DB.prepare(
        'INSERT INTO sharia_rulings (topic_key, topic, section, rulings, content, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      ).bind(r.topic_key, r.topic, r.section, r.rulings, r.content, SHARIA_RULINGS_VERSION),
    );
  }
  await env.CONTROL_DB.batch(stmts);
}

/** The topics a text is about, most-mentioned first. */
export function topicsFor(text: string): string[] {
  const t = String(text || '');
  const scores = Object.entries(TOPIC_TERMS)
    .map(([key, terms]) => [key, terms.reduce((n, term) => n + (t.includes(term) ? 1 : 0), 0)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return scores.slice(0, MAX_TOPICS).map(([k]) => k);
}

/** The ruling sections for this case's topics, as one text block ('' = none). */
export async function relevantRulings(env: Env, caseText: string): Promise<{ text: string; topics: string[] }> {
  const topics = topicsFor(caseText);
  if (!topics.length) return { text: '', topics };
  try {
    await ensureRulings(env);
    const ph = topics.map((_, i) => `?${i + 1}`).join(', ');
    const rs = await env.CONTROL_DB.prepare(
      `SELECT topic_key, topic, section, rulings, content FROM sharia_rulings WHERE topic_key IN (${ph}) ORDER BY id`,
    )
      .bind(...topics)
      .all<{ topic_key: string; topic: string; section: string; rulings: string | null; content: string }>();
    // Keep the topics in relevance order, then the document's own order.
    const rows = (rs.results ?? []).sort((a, b) => topics.indexOf(a.topic_key) - topics.indexOf(b.topic_key));
    let text = '';
    for (const r of rows) {
      const block = `## ${r.topic} — ${r.section}${r.rulings ? ` (القرارات: ${r.rulings})` : ''}\n${r.content}`;
      if (text.length + block.length > MAX_CHARS) break;
      text += (text ? '\n\n' : '') + block;
    }
    return { text, topics };
  } catch (e) {
    console.warn('[rulings] could not load the rulings table', e);
    return { text: '', topics };
  }
}
