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
  'insights.timeline': 'תובנות: הגיעו לציר הזמן',
  'insights.bars': 'תובנות: הגיעו לספירות היומיות',
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
} as const;

export type UsageName = keyof typeof LABELS;
export const USAGE_LABELS: Readonly<Record<string, string>> = LABELS;

/** One day of one phone: counter name -> how many times. */
export interface UsageDay {
  date: string;
  counts: Record<string, number>;
}

export const USAGE_MAX_DAYS = 14;
