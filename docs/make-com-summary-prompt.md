# פרומפט הסיכום של המסמכים — תרחיש make.com

התרחיש: **"webhook trigger - Legal AI - files summary Handler (Dropbox + Cloudflare) - v4"**.

הזרימה: `Webhooks → Dropbox (Download) → Text parser → Router` ואז שני ענפים, כל אחד:
`HTTP (legacy) → /v1/messages (Anthropic) → JSON Parse → JSON Create → HTTP (legacy) → /api/file-summary`.

- **ענף 2 (`pdf`)** — פעיל. שולח את ה-PDF כ-base64 ישירות ל-Claude (מודול 29).
- **ענף 1 (`DISABLED - DO…`)** — כבוי כרגע. עובר דרך `/extract-text` ואז `/v1/messages` (מודול 32).
  אם מפעילים אותו — יש להחיל עליו את אותו שינוי בשדה ה-`text`.

## חשוב — זה פרומפט משולב, לא רק סיכום

מודול ה-`/v1/messages` מחזיר **אובייקט JSON אחד** שמשמש גם לזיהוי החלטות וגם לסיכום:
`is_decision`, `doc_type`, `language`, `hearing_date`, `deadline_date`, `deadline_description`,
`required_action`, `action_target`, `summary_ar`, `summary_he`, `confidence_score`.

מודולי ה-JSON Parse/Create וה-`/api/file-summary` שאחריו תלויים ב**מפתחות האלה בדיוק**.
לכן **אין להחליף את כל הפרומפט** — רק מזריקים את "כללי כתיבת הסיכום" לתוך שדה ה-`text`,
ומשאירים את הסכימה זהה. הסיכום שנשמר ב-`file_summary` מגיע מ-`summary_ar` / `summary_he`.

## ⚠️ מלכודת: אסור מעברי שורה בתוך ערך מחרוזת

שדה ה-`text` חייב להיות **פסקה אחת רציפה בלי מעברי שורה**. `\n` שמודבק לתוך שדה ה-Request
content של make.com הופך למעבר שורה אמיתי בתוך מחרוזת JSON — וזה פוסל את ה-JSON כולו,
ואז Anthropic מחזירה `400 invalid_request_error: The request body is not valid JSON:
unexpected character: line 1 column 1 (char 0)`. מעברי שורה/הזחה **בין** שדות (מחוץ למחרוזות)
תקינים; רק בתוך מחרוזת אסור.

## גוף ה-Request content המלא (מודול 29 — ענף ה-`pdf`)

שים לב: ערך ה-`text` הוא שורה אחת ארוכה. `max_tokens` הועלה ל-3000 כדי שהסיכום הארוך לא ייחתך.

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 3000,
  "system": "أنت مساعد قانوني متخصص في القانون الإسرائيلي وقانون الأحوال الشخصية الإسلامي. تحليل المستندات القانونية فقط. لا تختلق أي تواريخ أو مواعيد أو معلومات. إذا لم تكن متأكداً من معلومة، اتركها فارغة (null). أعِد كائن JSON فقط. لا تستخدم Markdown ولا أسوار برمجية ولا علامات. يجب أن يكون أول حرف في ردك هو القوس {.",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": "{{base64(40.data)}}"
          }
        },
        {
          "type": "text",
          "text": "حلّل هذا المستند القانوني وأعد كائن JSON واحداً فقط بهذا الهيكل بالضبط: {\"is_decision\": true/false, \"doc_type\": \"القرار / الحكم / الأمر\", \"language\": \"ar أو he\", \"hearing_date\": \"YYYY-MM-DD أو null\", \"deadline_date\": \"YYYY-MM-DD أو null\", \"deadline_description\": \"null أو الوصف\", \"required_action\": \"respond_to_court / respond_to_other_party / appear / file_document / none\", \"action_target\": \"court / other_party / both / none\", \"summary_ar\": \"ملخّص بالعربية وفق قواعد الملخّص التالية\", \"summary_he\": \"null أو תקציר בעברית לפי כללי הסיכום הבאים\", \"confidence_score\": 0.95}. قواعد كتابة الملخّص (تنطبق على summary_ar و summary_he معاً): اكتب ملخّصاً لجوهر المستند ولا سيّما الحجج والطلبات القانونية المثارة فيه؛ بيّن طبيعة المستند (نوعه وما يطلبه) دون تكرار عنوان المستند لأنّ العنوان يُعرض بشكل منفصل على الشاشة؛ ركّز على الحجج والعِلل القانونية وأسانيدها والطلب/النصفة الأساسية والتواريخ والمواعيد المهمّة وأي قرار أو حكم؛ لا تُعِد سرد الوقائع أو الخلفية الوقائعية إلا بالقدر الضروري لفهم حجّة معيّنة فأسطر الملخّص مخصّصة للمضمون القانوني والحجج؛ لا تُدرِج اسم المحكمة ولا أسماء الأطراف أو أرقام هوياتهم (ت.ز / ת.ז) ولا أسماء المحامين ولا أي عناوين واحذف تفاصيل الترويسة التعريفية بالكامل؛ إذا كان المستند غنياً بالمعلومات فقد يمتدّ الملخّص حتى نصف صفحة (نحو 8–12 جملة) واستخدم جملاً أقل للمستند القصير دون حشو. استخرج فقط التواريخ الفعلية المذكورة صراحة في المستند. لا تكتب أي شيء خارج JSON."
        }
      ]
    }
  ]
}
```

## המלצות נלוות

1. **מילון המונחים בערבית** — שדה ה-`system` כאן קורא ל-Claude ישירות ומייצר `summary_ar`,
   אך אין בו את המילון. הוסף את בלוק המילון מ-[make-com-arabic-glossary.md](make-com-arabic-glossary.md)
   לסוף מחרוזת ה-`system` (לפני הגרש הסוגר), כדי שהמונחים יהיו נכונים (نفقة ולא מזונות וכו').
   שים לב: להדביק גם אותו כשורה אחת (עם `\n` כתווי escape ולא מעברי שורה אמיתיים).
2. **הענף המושבת (מודול 32)** — אם מפעילים את ענף ה-`extract-text`, הדבק בו את אותו שדה `text`.
3. **סיכומים ישנים** — כבר שמורים ב-`file_summary` ולא ישתנו; רק מסמכים חדשים יקבלו את הפורמט החדש.
4. **סנכרון עם הקוד** — הנוסח המקביל בקוד נמצא ב-
   [app/api/generate-summary/route.ts](../app/api/generate-summary/route.ts) (ה-fallback ליצירה לפי דרישה).
   שמור על השניים תואמים.
```
