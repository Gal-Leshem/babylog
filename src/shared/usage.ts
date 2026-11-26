/**
 * (owner, F15) Usage measurement: how often each parent uses each screen and action, counted on the phone per day (numbers
 * only, no content: no times, notes or names of entries) and sent once a day in the background. The founder reads them in the
 * sheet's "שימוש" tab (one row per parent, phone and day), to learn which parts of the app are used.
 */

/** Every counter the app keeps, with the title of its column in the sheet. Unknown names are refused by the server. */
const LABELS = {
  open: 'פתיחת האפליקציה',
  return: 'חזרה לאפליקציה',
  'tab.home': 'לשונית בית',
  'tab.history': 'לשונית היסטוריה',
  'tab.summary': 'לשונית סיכום',
  'tab.settings': 'לשונית הגדרות',
  'summary.table': 'סיכום: טבלה',
  'summary.insights': 'סיכום: תובנות',
  'summary.timeline': 'סיכום: הגיעו לציר הזמן',
  'summary.bars': 'סיכום: הגיעו לספירות היומיות',
  'questions.pick': 'תובנות: בחירת שאלות',
  'questions.on': 'תובנות: שאלה הודלקה',
  'questions.off': 'תובנות: שאלה כובתה',
  'questions.hide': 'תובנות: לא להציג יותר',
  'questions.how': 'תובנות: איך זה מחושב',
  'questions.suggest': 'תובנות: הציעו שאלה',
  // (owner) a question's card came into view (once per visit to "תובנות"): open questions that are never seen = page not used
  'seen.feedsToday': 'נצפתה: האכלות היום',
  'seen.gaps': 'נצפתה: כל כמה זמן מאכילים',
  'seen.nextFeed': 'נצפתה: ההנקה הבאה',
  'seen.sides': 'נצפתה: ימין ושמאל',
  'seen.cluster': 'נצפתה: הנקות בערב',
  'seen.night': 'נצפתה: הרצף הארוך בלילה',
  'seen.nightTrend': 'נצפתה: הרצף מתארך',
  'seen.sleepDay': 'נצפתה: שינה ביממה',
  'seen.nightStart': 'נצפתה: תחילת שנת הלילה',
  'seen.lastPoop': 'נצפתה: הקקי האחרון',
  'seen.diapersToday': 'נצפתה: פיפי וקקי היום',
  'seen.poop': 'נצפתה: קקי אחרי האכלה',
  'seen.unusual': 'נצפתה: היום חריג',
  'seen.bottlesToday': 'נצפתה: בקבוקים היום',
  'seen.bottleSize': 'נצפתה: כמה בבקבוק',
  'seen.bottleShare': 'נצפתה: האכלות עם בקבוק',
  'history.day': 'היסטוריה: יום-יום',
  'history.24h': 'היסטוריה: 24 שעות',
  'history.filter': 'היסטוריה: סינון',
  'log.feed_left': 'רישום: הנקה שמאל',
  'log.feed_right': 'רישום: הנקה ימין',
  'log.wet': 'רישום: פיפי',
  'log.poop': 'רישום: קקי',
  'log.both': 'רישום: פיפי + קקי',
  'log.asleep': 'רישום: נרדם',
  'log.awake': 'רישום: התעורר',
  'log.medicine': 'רישום: תרופה בכפתור',
  'meds.window': 'חלון תרופות',
  'meds.mark': 'תרופות: סימון בחלון',
  'toast.earlier': 'טוסט: היה לפני',
  'toast.undo': 'טוסט: בטל',
  'toast.wake': 'טוסט: לסמן שהתעורר',
  'form.add': 'הוספה בדיעבד',
  'form.edit': 'עריכה',
  'form.delete': 'מחיקה',
  'form.deleteWake': 'מחיקת התעוררות',
  'form.restore': 'החזרת עריכה',
  'sleep.forgotWake': 'שכחתם התעוררות',
  'settings.syncLog': 'יומן סנכרון',
  'settings.feedback': 'מסך משוב',
  'feedback.sent': 'משוב: נשלח',
  // (owner, performance session) every request this phone makes to the server, and the entries they carry: the servers share
  // one daily Google quota, so these show how much of it each family uses
  'sync.requests': 'בקשות לשרת',
  'sync.ops': 'רישומים שנשלחו לשרת',
  // (F18) bottles
  'log.bottle': 'רישום: בקבוק',
  'bottle.window': 'חלון בקבוק',
  'toast.amount': 'טוסט: כמות בקבוק',
  'bottle.defaultYes': 'בקבוק: ברירת מחדל עודכנה מההצעה',
  'bottle.defaultNo': 'בקבוק: לא עכשיו להצעה',
} as const;

export type UsageName = keyof typeof LABELS;
export const USAGE_LABELS: Readonly<Record<string, string>> = LABELS;

/**
 * (owner) The insight questions, for the state of each one per parent and day: shown by itself, turned on by hand, turned off by
 * hand, or waiting for data. Column titles in the sheet: "שאלה: <short name>".
 */
export const USAGE_QUESTIONS = {
  feedsToday: 'האכלות היום',
  gaps: 'כל כמה זמן מאכילים',
  nextFeed: 'ההנקה הבאה',
  sides: 'ימין ושמאל',
  cluster: 'הנקות בערב',
  night: 'הרצף הארוך בלילה',
  nightTrend: 'הרצף מתארך',
  sleepDay: 'שינה ביממה',
  nightStart: 'תחילת שנת הלילה',
  lastPoop: 'הקקי האחרון',
  diapersToday: 'פיפי וקקי היום',
  poop: 'קקי אחרי האכלה',
  unusual: 'היום חריג',
  bottlesToday: 'בקבוקים היום',
  bottleSize: 'כמה בבקבוק',
  bottleShare: 'האכלות עם בקבוק',
} as const;
export type UsageQuestion = keyof typeof USAGE_QUESTIONS;
export const QUESTION_STATES = { shown: 'מוצגת', on: 'הודלקה ידנית', off: 'כובתה ידנית', waiting: 'ממתינה לנתונים' } as const;
export type QuestionStateName = keyof typeof QUESTION_STATES;
export const questionColumn = (id: string): string => `שאלה: ${USAGE_QUESTIONS[id as UsageQuestion] ?? id}`;

/** One day of one phone: counter name -> how many times; and the state of each question at the end of the day. */
export interface UsageDay {
  date: string;
  counts: Record<string, number>;
  states?: Record<string, QuestionStateName>;
}

export const USAGE_MAX_DAYS = 14;
