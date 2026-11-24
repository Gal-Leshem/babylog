import type { Insights, Progress } from '../shared/insights';
import type { MoreAnswers } from '../shared/questions-data';
import type { UsageQuestion } from '../shared/usage';

/** Everything the questions are answered from. */
export interface AllData {
  ins: Insights;
  more: MoreAnswers;
}

/**
 * (owner, F16) "תובנות" as questions: each insight is a question with a short answer, grouped by topic. Every question is
 * automatic by default: shown once it has enough data (owner: a question without data stays off until it has some). A parent
 * may turn any question on or off by hand (per phone, `prefs.questions`); one turned on without enough data shows how much is
 * still missing. The words here are neutral (no "ישן" / "ישנה"): anything about the baby comes from words.ts.
 */
export type QuestionId = 'feedsToday' | 'gaps' | 'nextFeed' | 'sides' | 'cluster' | 'night' | 'nightTrend' | 'sleepDay' | 'nightStart' | 'lastPoop' | 'diapersToday' | 'poop' | 'diaper' | 'unusual';
export type Category = 'feed' | 'sleep' | 'diaper' | 'general';
// the usage measurement knows every question by the same id (a question missing there does not compile)
const sameIds: [QuestionId] extends [UsageQuestion] ? ([UsageQuestion] extends [QuestionId] ? true : never) : never = true;
void sameIds;

export const CATEGORIES: { id: Category; icon: string; title: string }[] = [
  { id: 'feed', icon: '🍼', title: 'האכלה' },
  { id: 'sleep', icon: '🌙', title: 'שינה' },
  { id: 'diaper', icon: '💧', title: 'חיתולים' },
  { id: 'general', icon: '📅', title: 'כללי' },
];

export interface Question {
  id: QuestionId;
  cat: Category;
  q: string;
  /** one line under the question in "בחירת שאלות" */
  desc: string;
  /** how much data it has and needs */
  prog: (a: AllData) => Progress;
  /** what is still missing, e.g. "התשובה תופיע אחרי 20 רווחים בין האכלות" */
  wait: (p: Progress) => string;
  /** "איך זה מחושב?" */
  how: (mergeWindowMin: number) => string[];
}

const soFar = (p: Progress) => `עד עכשיו ${p.have}.`;

const FIRST: Question[] = [
  {
    id: 'gaps',
    cat: 'feed',
    q: 'כל כמה זמן מאכילים?',
    desc: 'הרווח הרגיל בין האכלות, ביום ובלילה',
    prog: (a) => a.ins.progress.feedGaps,
    wait: (p) => `התשובה תופיע אחרי ${p.need} רווחים בין האכלות ב-7 הימים האחרונים. ${soFar(p)}`,
    how: (merge) => [
      `לכל שתי האכלות רצופות ב-7 הימים המלאים האחרונים נמדד הזמן מתחילת האחת לתחילת הבאה. הנקות בהפרש של עד ${merge} דקות הן האכלה אחת, ורווח של יותר מ-6 שעות לא נספר (כנראה האכלה שלא נרשמה).`,
      'המספר הגדול הוא האמצע: חצי מהרווחים קצרים ממנו וחצי ארוכים. "רוב הרווחים" הוא החצי האמצעי. לילה: מ-19:00 עד 07:00.',
    ],
  },
  {
    id: 'night',
    cat: 'sleep',
    q: 'מה הרצף הארוך בלילה?',
    desc: 'השינה הרציפה הארוכה בכל לילה, ומתי היא מתחילה',
    prog: (a) => a.ins.progress.nightSleep,
    wait: (p) => `התשובה תופיע אחרי ${p.need} לילות עם שינה רשומה. ${soFar(p)}`,
    how: () => [
      'בכל לילה (19:00 עד 07:00) נלקחת השינה הרציפה הארוכה ביותר שהתחילה בו. רק שינות שהסתיימו, ורק לילות שהסתיימו, עד 7 לילות.',
      'המספר הגדול הוא האמצע של הלילות האלה. "רצף ארוך" הוא 3 שעות ומעלה.',
      'שינה שלא נרשמה, או התעוררות שנשכחה, משנות את התשובה.',
    ],
  },
  {
    id: 'poop',
    cat: 'diaper',
    q: 'כמה זמן אחרי האכלה מגיע קקי?',
    desc: 'האם קקי מגיע בדרך כלל זמן קצר אחרי האכלה',
    prog: (a) => a.ins.progress.poopAfterFeed,
    wait: (p) => `התשובה תופיע אחרי ${p.need} פעמים קקי ב-7 הימים האחרונים. ${soFar(p)}`,
    how: () => [
      'לכל קקי (וגם פיפי + קקי) ב-7 הימים המלאים האחרונים נבדק אם הוא היה תוך שעה מתחילת האכלה, וכמה זמן אחריה.',
      'רוב היום ממילא קרוב להאכלה כלשהי, ולכן תשובה מוצגת רק כשזה קורה בבירור יותר ממה שהיה קורה במקרה. אחרת התשובה היא "אין קשר ברור".',
    ],
  },
  {
    id: 'diaper',
    cat: 'diaper',
    q: 'כמה זמן אחרי האכלה מחליפים חיתול?',
    desc: 'האם מחליפים חיתול בדרך כלל זמן קצר אחרי האכלה',
    prog: (a) => a.ins.progress.diaperAfterFeed,
    wait: (p) => `התשובה תופיע אחרי ${p.need} האכלות ב-7 הימים האחרונים. ${soFar(p)}`,
    how: () => [
      'לכל האכלה ב-7 הימים המלאים האחרונים נבדק אם הוחלף חיתול (כל סוג) תוך שעה מתחילתה, וכמה זמן אחריה.',
      'תשובה מוצגת רק כשזה קורה בבירור יותר ממה שהיה קורה במקרה. אחרת התשובה היא "אין קשר ברור".',
    ],
  },
];


const days = (p: Progress) => `התשובה תופיע אחרי ${p.need} ימים של רישום. ${soFar(p)}`;
const TODAY_HOW = (what: string, merge: number) => [
  `לכל אחד מ-7 הימים המלאים האחרונים נספרים ${what} עד אותה שעה ביום${merge ? ` (הנקות בהפרש של עד ${merge} דקות הן האכלה אחת)` : ''}. "יום רגיל" הוא האמצע של הימים האלה; יום שלא נרשם בו כלום לא נספר.`,
  'יותר או פחות מוצג רק כשההפרש ברור: לפחות 2, ולפחות רבע מהרגיל.',
];

const MORE: Question[] = [
  {
    id: 'feedsToday',
    cat: 'feed',
    q: 'כמה האכלות היום, לעומת יום רגיל?',
    desc: 'היום עד עכשיו, מול יום רגיל עד אותה שעה',
    prog: (a) => a.more.progress.feedsToday,
    wait: days,
    how: (merge) => TODAY_HOW('ההאכלות', merge),
  },
  {
    id: 'nextFeed',
    cat: 'feed',
    q: 'מתי ההנקה הבאה צפויה?',
    desc: 'הערכה לפי הקצב שלכם, לא המלצה',
    prog: (a) => a.more.progress.nextFeed,
    wait: (p) => `ההערכה תופיע אחרי ${p.need} רווחים בין האכלות ב-7 הימים האחרונים. ${soFar(p)}`,
    how: () => [
      'לשעת תחילת ההאכלה האחרונה מוסיפים את הרווח הרגיל אצלכם (ביום או בלילה, לפי שעת ההאכלה), מתוך 7 הימים המלאים האחרונים.',
      'זו הערכה לפי הקצב שהיה עד עכשיו, לא המלצה מתי להאכיל.',
    ],
  },
  {
    id: 'sides',
    cat: 'feed',
    q: 'יש איזון בין ימין לשמאל?',
    desc: 'כמה מההנקות היו בכל צד',
    prog: (a) => a.more.progress.sides,
    wait: (p) => `התשובה תופיע אחרי ${p.need} הנקות ב-7 הימים האחרונים. ${soFar(p)}`,
    how: () => ['כל לחיצה על "הנקה ימין" או "הנקה שמאל" ב-7 הימים המלאים האחרונים נספרת לצד שלה. "כמעט שווה": הפרש של עד 10 אחוזים מחצי.'],
  },
  {
    id: 'cluster',
    cat: 'feed',
    q: 'יש התקבצות הנקות בערב?',
    desc: 'האם בערב מאכילים בצפיפות רבה יותר',
    prog: (a) => a.more.progress.cluster,
    wait: (p) => `התשובה תופיע אחרי ${p.need} רווחים בין האכלות בערב וגם ביום. ${soFar(p)}`,
    how: () => [
      'הרווח הרגיל בין האכלות שמתחילות בין 17:00 ל-23:00, מול הרווח הרגיל בין 07:00 ל-17:00, ב-7 הימים המלאים האחרונים.',
      '"כן" כשהרווח בערב קצר לפחות ברבע מהרווח ביום.',
    ],
  },
  {
    id: 'nightTrend',
    cat: 'sleep',
    q: 'הרצף הארוך בלילה מתארך?',
    desc: 'הרצף הארוך בכל לילה, והאם הוא משתנה',
    prog: (a) => a.more.progress.nightTrend,
    wait: (p) => `התשובה תופיע אחרי ${p.need} לילות עם שינה רשומה. ${soFar(p)}`,
    how: () => [
      'בכל לילה (19:00 עד 07:00) נלקחת השינה הרציפה הארוכה ביותר. העמודות הן הלילות האחרונים, הישן ביותר מימין.',
      '"כן" כשהאמצע של 3 הלילות האחרונים ארוך לפחות ב-20 דקות מהאמצע של הלילות שלפניהם; "מתקצר" כשהוא קצר ב-20 דקות לפחות.',
    ],
  },
  {
    id: 'sleepDay',
    cat: 'sleep',
    q: 'כמה שעות שינה ביממה?',
    desc: 'סך השינה ביום, ואיך היה אתמול',
    prog: (a) => a.more.progress.sleepDay,
    wait: days,
    how: () => [
      'סך כל השינה שנרשמה בכל יום (חצות עד חצות) ב-7 הימים המלאים האחרונים; רק ימים שנרשמה בהם שינה.',
      'שינה שלא נרשמה מקטינה את הסך. אתמול "יותר" או "פחות" רק בהפרש של שעה לפחות.',
    ],
  },
  {
    id: 'nightStart',
    cat: 'sleep',
    q: 'מתי מתחילה שינת הלילה?',
    desc: 'השעה שבה מתחילה בדרך כלל השינה הארוכה של הערב',
    prog: (a) => a.more.progress.nightStart,
    wait: (p) => `התשובה תופיע אחרי ${p.need} לילות עם שינה רשומה. ${soFar(p)}`,
    how: () => ['בכל ערב נלקחת השינה הראשונה של שעתיים ומעלה שמתחילה בין 18:00 ל-02:00, ב-7 הלילות האחרונים שהסתיימו.'],
  },
  {
    id: 'lastPoop',
    cat: 'diaper',
    q: 'מתי היה הקקי האחרון?',
    desc: 'והזמן הרגיל אצלכם בין קקי לקקי',
    prog: (a) => a.more.progress.lastPoop,
    wait: (p) => `התשובה תופיע אחרי ${p.need} פעמים קקי ב-7 הימים האחרונים. ${soFar(p)}`,
    how: () => [
      'הזמן מהקקי האחרון שנרשם (כולל פיפי + קקי), והרווחים בין קקי לקקי ב-7 הימים האחרונים והיום.',
      '"יותר מהרגיל אצלכם": עבר יותר זמן מרוב הרווחים שנרשמו אצלכם. זו השוואה לרישום שלכם בלבד, לא הערכה רפואית.',
    ],
  },
  {
    id: 'diapersToday',
    cat: 'diaper',
    q: 'כמה פיפי וקקי היום?',
    desc: 'היום עד עכשיו, מול יום רגיל עד אותה שעה',
    prog: (a) => a.more.progress.diapersToday,
    wait: days,
    how: () => [...TODAY_HOW('הפיפי והקקי', 0), 'פיפי + קקי נספר גם כפיפי וגם כקקי.'],
  },
  {
    id: 'unusual',
    cat: 'general',
    q: 'היום חריג לעומת הרגיל?',
    desc: 'האכלות, פיפי, קקי והלילה האחרון, מול הרגיל אצלכם',
    prog: (a) => a.more.progress.unusual,
    wait: days,
    how: () => [
      'היום עד עכשיו מול יום רגיל אצלכם עד אותה שעה (האכלות, פיפי, קקי), והרצף הארוך בלילה האחרון מול הלילות שלפניו.',
      'רק הבדלים ברורים מוצגים.',
    ],
  },
];

const ORDER: QuestionId[] = ['feedsToday', 'gaps', 'nextFeed', 'sides', 'cluster', 'night', 'nightTrend', 'sleepDay', 'nightStart', 'lastPoop', 'diapersToday', 'poop', 'diaper', 'unusual'];
/** Every question, in the order they are shown inside their topic. */
export const QUESTIONS: Question[] = ORDER.map((id) => [...FIRST, ...MORE].find((q) => q.id === id)!);

/** (owner) Shown under the questions and in every "איך זה מחושב?". */
export const NOT_MEDICAL =
  'כל ההשוואות הן רק מול מה שנרשם אצלכם עד עכשיו, לא מול נורמות או ערכים רפואיים. זו לא המלצה ולא ייעוץ רפואי: בכל שאלה או דאגה פנו לרופא או לטיפת חלב.';

/** Whether the question has enough data, and whether it is shown (by hand, or automatically once ready). */
export function questionState(q: Question, a: AllData, choice: 'on' | 'off' | undefined): { ready: boolean; shown: boolean } {
  const p = q.prog(a);
  const ready = p.have >= p.need;
  return { ready, shown: choice === 'on' || (choice === undefined && ready) };
}
