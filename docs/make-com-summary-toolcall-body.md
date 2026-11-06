# Module 29 — replacement Request content (forced tool call)

Fixes the `Source is not valid JSON / DataError` crash in the summaries scenario
(`webhook trigger - Legal AI - files summary Handler (Dropbox + Cloudflare) - v4`).

## The bug this fixes

Claude was asked to return raw JSON as text. Hebrew legal abbreviations contain
an ASCII double quote — `עו"ד`, `שכ"ט`, `סה"כ`, `ת"ז`, `ב"כ` — and when one lands
inside a JSON string value unescaped, it **terminates the string early** and the
whole document becomes unparseable. Observed in run
`a75fc0d157c0436d8b6b3f929f14…`: `stop_reason: end_turn`, nothing truncated,
body ended `…ותשלום הוצאות ושכ"ט עו"ד.", "confidence_score": 0.97}`.

It is intermittent purely by luck of vocabulary — the run 3 seconds earlier
succeeded because that summary happened to use no abbreviation. Israeli legal
documents use them constantly, so this fires often.

**Forced tool use removes the failure mode entirely**: the model returns
structured tool input, and the API owns the escaping. Malformed JSON becomes
impossible rather than merely discouraged. The decisions scenario already works
this way, which is why it has never hit this.

---

## ⚠️ DO NOT PASTE THE SCHEMA BELOW AS-IS — it is wrong

The `input_schema` in this file was derived from `make-com-summary-prompt.md`,
which is **stale**. A live read of module 11's mapper (`scenario_module_get` on
scenario 9458704, 2026-10-27) shows it actually consumes:

```
{{13.doc_type}}  {{13.language}}  {{13.summary_he}}  {{13.summary_ar}}
{{13.key_dates}} {{13.legal_refs}} {{13.legal_issues}} {{13.confidence_score}}
```

plus `{{36.$1}}` / `{{36.$2}}` (client/case id) and `{{1.name}}` / `{{1.id}}`.

So the real contract has **`key_dates`, `legal_refs`, `legal_issues`** — none of
which appear in the schema below — and does **not** use `is_decision`,
`hearing_date`, `deadline_date`, `deadline_description`, `required_action` or
`action_target`, which the schema below does include.

Pasting this unmodified would silently blank three fields in every stored
summary. **Derive the tool schema from module 11's actual mapper**, not from this
file or from `make-com-summary-prompt.md`. Everything else here — the tool-call
approach, the system-prompt cleanup, deleting module 13 — stands.

### Second gotcha: `ai_model` is hardcoded

Module 11's mapper sets `ai_model` to the literal string `"claude-sonnet-4-6"`.
It is **not** read from module 29's response. So the optional model swap at the
bottom of this file requires editing **two** modules — change 29's `model` and
11's `ai_model` together, or every stored summary will be mislabelled with a
model that didn't produce it.

---

## Paste this into module 29 → Request content

Replace the entire body. `40` is the Dropbox *Download a File* module — verify
that number on the module circle before pasting.

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 8000,
  "system": "أنت مساعد قانوني متخصص في القانون الإسرائيلي وقانون الأحوال الشخصية الإسلامي. تحليل المستندات القانونية فقط. لا تختلق أي تواريخ أو مواعيد أو معلومات. إذا لم تكن متأكداً من معلومة، اتركها فارغة (null).",
  "tools": [
    {
      "name": "record_summary",
      "description": "Record the structured analysis of the legal document.",
      "input_schema": {
        "type": "object",
        "properties": {
          "is_decision": { "type": "boolean", "description": "true إذا كان المستند قراراً أو حكماً أو أمراً صادراً عن المحكمة أو القاضي." },
          "doc_type": { "type": "string", "description": "نوع المستند: القرار / الحكم / الأمر / طلب مستعجل / لائحة دعوى وما شابه." },
          "language": { "type": "string", "enum": ["ar", "he"], "description": "لغة المستند الأساسية." },
          "hearing_date": { "type": ["string", "null"], "description": "تاريخ جلسة يجب على الأطراف حضورها، بصيغة YYYY-MM-DD، أو null. مهلة تقديم رد ليست جلسة." },
          "deadline_date": { "type": ["string", "null"], "description": "آخر موعد لتقديم رد أو مستند، بصيغة YYYY-MM-DD، أو null." },
          "deadline_description": { "type": ["string", "null"], "description": "وصف مختصر للموعد النهائي، أو null." },
          "required_action": { "type": "string", "enum": ["respond_to_court", "respond_to_other_party", "appear", "file_document", "none"] },
          "action_target": { "type": "string", "enum": ["court", "other_party", "both", "none"] },
          "summary_ar": { "type": "string", "description": "الملخّص بالعربية وفق قواعد الملخّص الواردة في رسالة المستخدم." },
          "summary_he": { "type": ["string", "null"], "description": "הסיכום בעברית לפי אותם כללי סיכום." },
          "confidence_score": { "type": "number", "description": "درجة الثقة بين 0 و 1." }
        },
        "required": ["is_decision", "doc_type", "language", "hearing_date", "deadline_date", "deadline_description", "required_action", "action_target", "summary_ar", "summary_he", "confidence_score"]
      }
    }
  ],
  "tool_choice": { "type": "tool", "name": "record_summary" },
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
          "text": "حلّل هذا المستند القانوني واستدعِ أداة record_summary مرة واحدة فقط مع تعبئة جميع الحقول. قواعد كتابة الملخّص (تنطبق على summary_ar و summary_he معاً): اكتب ملخّصاً لجوهر المستند ولا سيّما الحجج والطلبات القانونية المثارة فيه؛ بيّن طبيعة المستند (نوعه وما يطلبه) دون تكرار عنوان المستند لأنّ العنوان يُعرض بشكل منفصل على الشاشة؛ ركّز على الحجج والعِلل القانونية وأسانيدها والطلب أو النصفة الأساسية والتواريخ والمواعيد المهمّة وأي قرار أو حكم؛ لا تُعِد سرد الوقائع أو الخلفية الوقائعية إلا بالقدر الضروري لفهم حجّة معيّنة، فأسطر الملخّص مخصّصة للمضمون القانوني والحجج؛ لا تُدرِج اسم المحكمة ولا أسماء الأطراف أو أرقام هوياتهم (ت.ز) ولا أسماء المحامين ولا أي عناوين، واحذف تفاصيل الترويسة التعريفية بالكامل؛ إذا كان المستند غنياً بالمعلومات فقد يمتدّ الملخّص حتى نصف صفحة (نحو 8 إلى 12 جملة)، واستخدم جملاً أقل للمستند القصير دون حشو. املأ summary_ar و summary_he معاً دائماً مهما كانت لغة المستند الأصلية. استخرج فقط التواريخ الفعلية المذكورة صراحة في المستند."
        }
      ]
    }
  ]
}
```

### What changed and why

| Change | Reason |
|---|---|
| Added `tools` + `tool_choice` | The actual fix — schema enforced by the API, escaping handled for us |
| Dropped *"return only JSON / no markdown / first character must be `{`"* from `system` | Obsolete under tool use, and those instructions were never reliable anyway |
| Dropped the inline JSON-shape spec from `text` | The schema now lives in `input_schema`; keeping both invites drift |
| `max_tokens` 3000 → 8000 | Not the cause here (`end_turn`), but two half-page bilingual summaries ran close to the cap. Headroom is nearly free — you are billed for tokens produced, not the ceiling |
| Field names unchanged | All 11 keys are identical, so everything downstream still lines up |

> **Still one line.** The `text` value above is a single continuous line. Keep it
> that way — a real newline inside a JSON string breaks the request body, which
> is the pitfall already documented in `make-com-summary-prompt.md`.

---

## Downstream rewiring — module 13 goes away

With `tool_choice`, the response's first content block is a `tool_use` block
whose `input` is **already a structured object**. Module 29 has
`Parse response: true`, so Make hands it to you parsed. There is nothing left to
parse — and module 13 (`JSON – Parse JSON`), the module that has been failing,
becomes dead weight.

1. Open module **11** (`JSON – Create JSON`). Its fields currently map from
   `{{13.…}}`.
2. Repoint each to the tool input, e.g.
   `{{13.summary_ar}}` → `{{29.data.content[1].input.summary_ar}}`
   and the same for the other ten fields.
3. Delete module **13**, reconnecting `29 → 11`.
4. Save the scenario (floppy icon), then refresh to confirm it stuck.

> **Check the array index first.** Make indexes arrays from **1**, not 0 — so it
> is `content[1]`, not `content[0]`. Before remapping, open module 13 and look at
> its existing source mapping: whatever index convention it already uses for
> `content[…].text` is the one to keep for `content[…].input`.

---

## Optional, after this is verified working

- **Model swap:** `"claude-sonnet-4-6"` → `"claude-sonnet-5"`. Same 1M context
  and 600-page PDF ceiling, $2/$10 per MTok instead of $3/$15. Forced tool use is
  supported. Do it as a *separate* change so that if anything regresses you know
  which edit caused it.
- **Error handler on 29** — `Break` with retry 3 × 10 min, plus "allow storing
  incomplete executions". Stops a transient 429/529 from deactivating the
  scenario (see `make-com-pipeline-hardening.md` §5).
- **Same treatment for the decisions scenario** — it already uses a tool call, so
  it needs only the error handler and the optional model swap.
