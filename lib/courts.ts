// Israeli courts & tribunals reference list, transcribed from the office's
// "עליון ומחוזי" source document. Powers the filterable court picker in the
// New-Case modal: the user types a category keyword (שלום / מחוזי / משפחה /
// שרעי / עבודה / רבני / דרוזי / כנסייתי / תעבורה / מקומיים …) or a city, and the
// matching courts show as a short "<category> <city>" label.
//
// The picker STORES the short label (e.g. "שלום ירושלים") into case.court —
// address/phone are kept here only as reference (they are NOT searched, so a
// street named "שלום" can't false-match the שלום category).

export interface CourtEntry {
  /** Short display category — the keyword the user types to filter. */
  category: string;
  /** City (may carry a short qualifier); '' for a single national court. */
  city: string;
  /** Full official name. Searched, so denominations/qualifiers match. */
  name: string;
  /** Street address (reference only — not searched). */
  address?: string;
  /** Contact phone (reference only — not searched). */
  phone?: string;
  /** Extra search terms (alt spellings, district, denomination). */
  keywords?: string;
}

// Judiciary national call centre, shared by most courts.
const C = '077-2703333 / *3852';

export const COURTS: CourtEntry[] = [
  // ── עליון ─────────────────────────────────────────────
  { category: 'עליון', city: '', name: 'בית המשפט העליון (יושב גם כבג"ץ)', address: 'רחוב שערי משפט 1, קריית דוד בן-גוריון, ירושלים', phone: C, keywords: 'בגץ בג״ץ ירושלים' },

  // ── מחוזי ─────────────────────────────────────────────
  { category: 'מחוזי', city: 'ירושלים', name: 'בית המשפט המחוזי ירושלים', address: 'רחוב צלאח א-דין 40', phone: C },
  { category: 'מחוזי', city: 'תל אביב', name: 'בית המשפט המחוזי תל אביב', address: 'רחוב ויצמן 1, תל אביב-יפו', phone: '03-6926211; ' + C },
  { category: 'מחוזי', city: 'חיפה', name: 'בית המשפט המחוזי חיפה', address: 'שדרות הפלי"ם 12, קריית הממשלה', phone: '04-8698000; ' + C },
  { category: 'מחוזי', city: 'נצרת', name: 'בית המשפט המחוזי נצרת', address: 'קריית הממשלה ע"ש יצחק רבין, דרך קריית הממשלה 2, נוף הגליל', phone: '04-6087985; ' + C, keywords: 'נוף הגליל' },
  { category: 'מחוזי', city: 'באר שבע', name: 'בית המשפט המחוזי באר שבע', address: 'רחוב התקווה 5, קריית הממשלה', phone: '08-6470444; ' + C },
  { category: 'מחוזי', city: 'מרכז (לוד)', name: 'בית המשפט המחוזי מרכז-לוד', address: 'שדרות הציונות 3, לוד', phone: C, keywords: 'מרכז לוד' },

  // ── שלום ──────────────────────────────────────────────
  { category: 'שלום', city: 'ירושלים', name: 'בית משפט השלום ירושלים', address: 'רחוב חשין 6', phone: C },
  { category: 'שלום', city: 'בית שמש', name: 'בית משפט השלום בית שמש', address: 'רחוב הרצל 9', phone: C },
  { category: 'שלום', city: 'תל אביב', name: 'בית משפט השלום תל אביב', address: 'רחוב ויצמן 1 (היכל המשפט), תל אביב-יפו', phone: '074-7484548; ' + C },
  { category: 'שלום', city: 'בת ים', name: 'בית משפט השלום בת ים', address: 'רחוב הרב ניסנבוים 7 (היכל המשפט בת ים)', phone: C },
  { category: 'שלום', city: 'הרצליה', name: 'בית משפט השלום הרצליה', address: 'רחוב בן גוריון 31', phone: '09-9620444' },
  { category: 'שלום', city: 'פתח תקווה', name: 'בית משפט השלום פתח תקווה', address: 'רחוב באזל 1', phone: '03-9299454; ' + C },
  { category: 'שלום', city: 'ראשון לציון', name: 'בית משפט השלום ראשון לציון', address: 'רחוב ישראל גלילי 5', phone: '03-9425500; ' + C },
  { category: 'שלום', city: 'רחובות', name: 'בית משפט השלום רחובות', address: "רחוב רוז'נסקי 9", phone: '08-9485335' },
  { category: 'שלום', city: 'רמלה', name: 'בית משפט השלום רמלה', address: 'שדרות ויצמן 3', phone: C },
  { category: 'שלום', city: 'נתניה', name: 'בית משפט השלום נתניה', address: 'רחוב הרצל 57', phone: '09-8605605; ' + C },
  { category: 'שלום', city: 'כפר סבא', name: 'בית משפט השלום כפר סבא', address: 'אזרחי: רחוב הטחנה 5; פלילי: רחוב טשרניחובסקי 14', phone: C },
  { category: 'שלום', city: 'חיפה', name: 'בית משפט השלום חיפה', address: 'שדרות הפלי"ם 12', phone: '04-8698000; ' + C },
  { category: 'שלום', city: 'עכו', name: 'בית משפט השלום עכו', address: 'רחוב יהושפט 15', phone: '04-9876600; ' + C },
  { category: 'שלום', city: 'חדרה', name: 'בית משפט השלום חדרה', address: 'רחוב הלל יפה 7', phone: '04-6327590; ' + C },
  { category: 'שלום', city: 'קריות', name: 'בית משפט השלום קריות', address: 'דרך עכו 194, קריית ביאליק', phone: '04-8748777; ' + C, keywords: 'קריית ביאליק' },
  { category: 'שלום', city: 'נצרת', name: 'בית משפט השלום נצרת', address: 'קריית הממשלה ע"ש יצחק רבין, נוף הגליל', phone: C, keywords: 'נוף הגליל' },
  { category: 'שלום', city: 'טבריה', name: 'בית משפט השלום טבריה', address: 'רחוב חשמונאים 3', phone: C },
  { category: 'שלום', city: 'צפת', name: 'בית משפט השלום צפת', address: 'מרום כנען (מעלה כנען), בניין המשטרה', phone: C },
  { category: 'שלום', city: 'בית שאן', name: 'בית משפט השלום בית שאן', address: 'רחוב שאול המלך 31', phone: '074-7485251; ' + C },
  { category: 'שלום', city: 'עפולה', name: 'בית משפט השלום עפולה', address: 'רחוב מנחם אוסישקין 42', phone: '04-6525200; ' + C },
  { category: 'שלום', city: 'קריית שמונה', name: 'בית משפט השלום קריית שמונה', address: 'שדרות תל חי 97', phone: '04-6956000; ' + C },
  { category: 'שלום', city: 'קצרין', name: 'בית משפט השלום קצרין', address: 'רחוב שיאון 1', phone: '04-6961696; ' + C },
  { category: 'שלום', city: 'מסעדה', name: 'בית משפט השלום מסעדה', address: 'מול בית הדואר, כפר מסעדה (רמת הגולן)', phone: '074-7485801; ' + C, keywords: 'רמת הגולן' },
  { category: 'שלום', city: 'באר שבע', name: 'בית משפט השלום באר שבע', address: 'רחוב התקווה 5', phone: C },
  { category: 'שלום', city: 'אשדוד', name: 'בית משפט השלום אשדוד', address: 'רחוב מורדי הגטאות 1', phone: '08-8514001; ' + C },
  { category: 'שלום', city: 'אשקלון', name: 'בית משפט השלום אשקלון', address: 'שדרות בן גוריון 19', phone: C },
  { category: 'שלום', city: 'קריית גת', name: 'בית משפט השלום קריית גת', address: 'רחוב חשוון 12', phone: C },
  { category: 'שלום', city: 'דימונה', name: 'בית משפט השלום דימונה', address: 'שדרות בן גוריון 1 (כיכר דנמרק)', phone: '08-6543222' },
  { category: 'שלום', city: 'אילת', name: 'בית משפט השלום אילת', address: 'דרך יותם 3', phone: '074-7488020; ' + C },

  // ── משפחה ─────────────────────────────────────────────
  { category: 'משפחה', city: 'ירושלים', name: 'בית המשפט לענייני משפחה ירושלים', address: 'רחוב בית הדפוס 12, גבעת שאול', phone: C },
  { category: 'משפחה', city: 'תל אביב', name: 'בית המשפט לענייני משפחה מחוז תל אביב', address: 'דרך בן גוריון 38, רמת גן', phone: C, keywords: 'רמת גן מחוז' },
  { category: 'משפחה', city: 'ראשון לציון', name: 'בית המשפט לענייני משפחה ראשון לציון', address: 'רחוב ישראל גלילי 5', phone: C },
  { category: 'משפחה', city: 'כפר סבא', name: 'בית המשפט לענייני משפחה כפר סבא', address: 'רחוב הטחנה 5', phone: C },
  { category: 'משפחה', city: 'פתח תקווה', name: 'בית המשפט לענייני משפחה פתח תקווה', address: 'רחוב באזל 1', phone: C },
  { category: 'משפחה', city: 'חיפה', name: 'בית המשפט לענייני משפחה חיפה', address: 'שדרות הפלי"ם 12', phone: C },
  { category: 'משפחה', city: 'קריות', name: 'בית המשפט לענייני משפחה קריות', address: 'דרך עכו 194, קריית ביאליק', phone: C, keywords: 'קריית ביאליק' },
  { category: 'משפחה', city: 'חדרה', name: 'בית המשפט לענייני משפחה חדרה', address: 'רחוב דוד שמעוני 42', phone: '04-6302300; ' + C },
  { category: 'משפחה', city: 'נצרת', name: 'בית המשפט לענייני משפחה נצרת', address: 'היכל המשפט, קריית יצחק רבין, נוף הגליל', phone: C, keywords: 'נוף הגליל' },
  { category: 'משפחה', city: 'טבריה', name: 'בית המשפט לענייני משפחה טבריה', address: 'שדרות הציונות 1', phone: C },
  { category: 'משפחה', city: 'קריית שמונה', name: 'בית המשפט לענייני משפחה קריית שמונה', address: 'כיכר צה"ל 1', phone: C },
  { category: 'משפחה', city: 'באר שבע', name: 'בית המשפט לענייני משפחה באר שבע', address: 'רחוב התקווה 5', phone: C },
  { category: 'משפחה', city: 'אשדוד', name: 'בית המשפט לענייני משפחה אשדוד', address: "רחוב מורדי הגטאות 1, רובע ב'", phone: C },
  { category: 'משפחה', city: 'קריית גת', name: 'בית המשפט לענייני משפחה קריית גת', address: 'רחוב חשוון 12', phone: C },
  { category: 'משפחה', city: 'אילת', name: 'בית המשפט לענייני משפחה אילת', address: 'דרך יותם 3', phone: C },

  // ── תעבורה ────────────────────────────────────────────
  { category: 'תעבורה', city: 'ירושלים', name: 'בית משפט השלום לתעבורה ירושלים', address: 'רחוב בית הדפוס 12, גבעת שאול', phone: C },
  { category: 'תעבורה', city: 'תל אביב', name: 'בית משפט השלום לתעבורה תל אביב', address: 'רחוב הרב ניסנבוים 7 (היכל המשפט בת ים)', phone: C, keywords: 'בת ים' },
  { category: 'תעבורה', city: 'מרכז (פתח תקווה)', name: 'בית משפט השלום לתעבורה מרכז', address: 'רחוב משה הס 20, פתח תקווה', phone: C, keywords: 'מרכז פתח תקווה' },
  { category: 'תעבורה', city: 'חיפה', name: 'בית משפט השלום לתעבורה חיפה', address: 'שדרות הפלי"ם 12', phone: C },
  { category: 'תעבורה', city: 'חדרה', name: 'בית משפט השלום לתעבורה חדרה', address: "רחוב הלל יפה 7א'", phone: C },
  { category: 'תעבורה', city: 'עכו', name: 'בית משפט השלום לתעבורה עכו', address: 'רחוב יהושפט 15', phone: C },
  { category: 'תעבורה', city: 'נצרת', name: 'בית משפט השלום לתעבורה נצרת', address: 'היכל המשפט, קריית יצחק רבין, נוף הגליל', phone: C, keywords: 'נוף הגליל' },
  { category: 'תעבורה', city: 'באר שבע', name: 'בית משפט השלום לתעבורה באר שבע', address: 'רחוב התקווה 5', phone: C },
  { category: 'תעבורה', city: 'אילת', name: 'בית משפט השלום לתעבורה אילת', address: 'דרך יותם 3', phone: C },

  // ── נוער / תביעות קטנות / ימאות ────────────────────────
  { category: 'נוער', city: 'כל הארץ', name: 'בתי המשפט לנוער', address: 'בתוך בתי משפט השלום והמחוזיים', phone: C },
  { category: 'תביעות קטנות', city: 'כל הארץ', name: 'בתי המשפט לתביעות קטנות', address: 'בתוך בתי משפט השלום', phone: C },
  { category: 'ימאות', city: 'חיפה', name: 'בית המשפט לימאות', address: 'שדרות הפלי"ם 12 (בבית המשפט המחוזי חיפה)', phone: C },

  // ── עניינים מקומיים ───────────────────────────────────
  { category: 'מקומיים', city: 'ירושלים', name: 'בית המשפט לעניינים מקומיים ירושלים', address: 'רחוב שבטי ישראל 7', phone: '02-6297449', keywords: 'עניינים מקומיים' },
  { category: 'מקומיים', city: 'תל אביב', name: 'בית המשפט לעניינים מקומיים תל אביב', address: 'שדרות שאול המלך 39, תל אביב-יפו', phone: '03-7249222', keywords: 'עניינים מקומיים' },
  { category: 'מקומיים', city: 'חיפה', name: 'בית המשפט לעניינים מקומיים חיפה', address: 'שדרות הפלי"ם 16', phone: '04-8357876; *3852', keywords: 'עניינים מקומיים' },
  { category: 'מקומיים', city: 'חולון', name: 'בית המשפט לעניינים מקומיים חולון', address: 'רחוב הנוטרים 3', phone: '03-5027060', keywords: 'עניינים מקומיים' },
  { category: 'מקומיים', city: 'בת ים', name: 'בית המשפט לעניינים מקומיים בת ים', address: 'רחוב הרב ניסנבוים 7', phone: '03-5556080', keywords: 'עניינים מקומיים' },
  { category: 'מקומיים', city: 'ראשון לציון', name: 'בית המשפט לעניינים מקומיים ראשון לציון', address: 'רחוב ישראל גלילי 5', phone: '03-9425536', keywords: 'עניינים מקומיים' },
  { category: 'מקומיים', city: 'נתניה', name: 'בית המשפט לעניינים מקומיים נתניה', address: 'רחוב הרצל 57', phone: '09-8607637', keywords: 'עניינים מקומיים' },

  // ── עבודה ─────────────────────────────────────────────
  { category: 'עבודה', city: 'ארצי', name: 'בית הדין הארצי לעבודה', address: 'רחוב קרן היסוד 20, ירושלים', phone: C, keywords: 'ארצי לעבודה ירושלים' },
  { category: 'עבודה', city: 'ירושלים', name: 'בית הדין האזורי לעבודה ירושלים', address: 'רחוב בית הדפוס 20, מגדל דונה, גבעת שאול', phone: '02-6546444; ' + C, keywords: 'אזורי לעבודה' },
  { category: 'עבודה', city: 'תל אביב', name: 'בית הדין האזורי לעבודה תל אביב', address: 'רחוב הרב ניסנבוים 7 (היכל המשפט בת ים)', phone: '03-5128302; ' + C, keywords: 'אזורי לעבודה בת ים' },
  { category: 'עבודה', city: 'חיפה', name: 'בית הדין האזורי לעבודה חיפה', address: 'שדרות הפלי"ם 12, קריית הממשלה', phone: '04-8698076; ' + C, keywords: 'אזורי לעבודה' },
  { category: 'עבודה', city: 'נצרת', name: 'בית הדין האזורי לעבודה נצרת', address: 'היכל המשפט, קריית יצחק רבין, נוף הגליל', phone: C, keywords: 'אזורי לעבודה נוף הגליל' },
  { category: 'עבודה', city: 'באר שבע', name: 'בית הדין האזורי לעבודה באר שבע', address: 'רחוב התקווה 5', phone: '074-7488333; ' + C, keywords: 'אזורי לעבודה' },

  // ── רבני ──────────────────────────────────────────────
  { category: 'רבני', city: 'הגדול (ירושלים)', name: 'בית הדין הרבני הגדול לערעורים', address: "רחוב המלך ג'ורג' 24, ירושלים", phone: '*5889', keywords: 'גדול ערעורים ירושלים' },
  { category: 'רבני', city: 'ירושלים', name: 'בית הדין הרבני האזורי ירושלים', address: 'רחוב עם ועולמו 4, גבעת שאול', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'תל אביב', name: 'בית הדין הרבני האזורי תל אביב', address: 'שדרות דוד המלך 33, תל אביב-יפו', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'חיפה', name: 'בית הדין הרבני האזורי חיפה', address: 'דרך העצמאות 24', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'פתח תקווה', name: 'בית הדין הרבני האזורי פתח תקווה', address: 'רחוב זוסיה שפיגל 6', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'נתניה', name: 'בית הדין הרבני האזורי נתניה', address: 'רחוב ראובן ברקת 3', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'רחובות', name: 'בית הדין הרבני האזורי רחובות', address: 'רחוב מוטי קינד 10', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'אשדוד', name: 'בית הדין הרבני האזורי אשדוד', address: 'דרך מנחם בגין 1', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'אשקלון', name: 'בית הדין הרבני האזורי אשקלון', address: 'שדרות בן גוריון 19', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'באר שבע', name: 'בית הדין הרבני האזורי באר שבע', address: 'רחוב התקווה 4', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'טבריה', name: 'בית הדין הרבני האזורי טבריה', address: 'רחוב בן זכאי 16', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'צפת', name: 'בית הדין הרבני האזורי צפת', address: 'רחוב ויצמן 6', phone: '*5889', keywords: 'אזורי' },
  { category: 'רבני', city: 'אריאל', name: 'בית הדין הרבני האזורי אריאל', address: 'רחוב יהודה 15', phone: '*5889', keywords: 'אזורי' },

  // ── שרעי ──────────────────────────────────────────────
  { category: 'שרעי', city: 'ערעורים', name: 'בית הדין השרעי לערעורים', address: 'מושב רשמי בירושלים; הדיונים מתקיימים בבאקה אל-גרביה', phone: '', keywords: 'ערעורים ירושלים באקה אל-גרביה' },
  { category: 'שרעי', city: 'ירושלים', name: 'בית הדין השרעי בירושלים', address: 'רחוב הלל 37', phone: '' },
  { category: 'שרעי', city: 'יפו', name: 'בית הדין השרעי ביפו', address: 'שדרות ירושלים 111, יפו', phone: '', keywords: 'תל אביב יפו' },
  { category: 'שרעי', city: 'טייבה', name: 'בית הדין השרעי בטייבה', address: 'טייבה', phone: '' },
  { category: 'שרעי', city: 'באקה אל-גרביה', name: 'בית הדין השרעי בבאקה אל-גרביה', address: 'באקה אל-גרביה', phone: '' },
  { category: 'שרעי', city: 'עכו', name: 'בית הדין השרעי בעכו', address: 'רחוב הגליל 1', phone: '' },
  { category: 'שרעי', city: 'נצרת', name: 'בית הדין השרעי בנצרת', address: 'רחוב תופיק זיאד 1 (כיכר העיר)', phone: '' },
  { category: 'שרעי', city: 'חיפה', name: 'בית הדין השרעי בחיפה', address: 'רחוב שיבת ציון 60', phone: '' },
  { category: 'שרעי', city: 'באר שבע', name: 'בית הדין השרעי בבאר שבע', address: 'רחוב קרן היסוד 4', phone: '' },
  { category: 'שרעי', city: 'רהט', name: 'בית הדין השרעי — שלוחת רהט', address: 'רהט', phone: '', keywords: 'באר שבע שלוחה' },

  // ── דרוזי ─────────────────────────────────────────────
  { category: 'דרוזי', city: 'עכו', name: 'בית הדין הדתי הדרוזי בעכו', address: 'רחוב שלום הגליל 1, ת"ד 8260, עכו', phone: '073-3924599' },
  { category: 'דרוזי', city: 'ערעורים (עכו)', name: 'בית הדין הדתי הדרוזי לערעורים', address: 'רחוב שלום הגליל 1, עכו (אותו מבנה)', phone: '073-3924599', keywords: 'ערעורים עכו' },

  // ── כנסייתי ───────────────────────────────────────────
  { category: 'כנסייתי', city: 'ירושלים – יוונית-אורתודוקסית', name: 'בית הדין הכנסייתי של הפטריארכיה היוונית-אורתודוקסית', address: 'מתחם הפטריארכיה, הרובע הנוצרי, העיר העתיקה, ירושלים', phone: '', keywords: 'נוצרי יוונית אורתודוקסית' },
  { category: 'כנסייתי', city: 'ירושלים – לטינית', name: 'בית הדין הכנסייתי הלטיני', address: 'הפטריארכיה הלטינית, ליד שער יפו, העיר העתיקה, ירושלים', phone: '', keywords: 'נוצרי לטינית קתולית' },
  { category: 'כנסייתי', city: 'נצרת – לטינית', name: 'בית הדין הלטיני — נצרת', address: 'מתחם הכנסייה הלטינית, נצרת', phone: '', keywords: 'נוצרי לטינית קתולית' },
  { category: 'כנסייתי', city: 'חיפה – מלכיתית', name: 'בית הדין של העדה המלכיתית (יוונית-קתולית)', address: 'הארכיבישופות המלכיתית (המוטראניה), חיפה', phone: '', keywords: 'נוצרי מלכיתית יוונית קתולית' },
  { category: 'כנסייתי', city: 'חיפה – מרונית', name: 'בית הדין המרוני', address: 'הארכיבישופות המרונית, חיפה', phone: '', keywords: 'נוצרי מרונית' },
  { category: 'כנסייתי', city: 'ירושלים – ארמנית', name: 'בית הדין של הפטריארכיה הארמנית', address: 'הרובע הארמני, העיר העתיקה, ירושלים', phone: '', keywords: 'נוצרי ארמנית' },
  { category: 'כנסייתי', city: 'ירושלים – עדות נוספות', name: 'ערכאות עדתיות של עדות נוצריות מוכרות נוספות', address: 'סורית-אורתודוקסית, סורית-קתולית, ארמנית-קתולית, כלדית, אפיסקופלית ועוד, ירושלים', phone: '', keywords: 'נוצרי סורית כלדית אפיסקופלית' },
];

/** Short label shown in the picker and stored on the case: "<category> <city>"
 *  (or just the category when there is no city, e.g. the Supreme Court). */
export function courtLabel(c: CourtEntry): string {
  return c.city ? `${c.category} ${c.city}` : c.category;
}

// Strip quotes/geresh and collapse whitespace so "ג'ורג'" / "בג\"ץ" match cleanly.
const normalize = (s: string): string =>
  s.replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Courts matching every whitespace-separated token in `query`, searched over
 * category + city + name + keywords (NOT the address, so a street named "שלום"
 * can't false-match the שלום category). Empty query returns the head of the
 * full list. Results are capped so the dropdown stays light.
 */
export function filterCourts(query: string, limit = 60): CourtEntry[] {
  const q = normalize(query);
  if (!q) return COURTS.slice(0, limit);
  const tokens = q.split(' ').filter(Boolean);
  const out: CourtEntry[] = [];
  for (const c of COURTS) {
    const hay = normalize(`${c.category} ${c.city} ${c.name} ${c.keywords || ''}`);
    if (tokens.every((t) => hay.includes(t))) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}
