import type { Insights, Progress } from '../shared/insights';

/**
 * (owner, F16) "תובנות" as questions: each insight is a question with a short answer, grouped by topic. Every question is
 * automatic by default: shown once it has enough data (owner: a question without data stays off until it has some). A parent
 * may turn any question on or off by hand (per phone, `prefs.questions`); one turned on without enough data shows how much is
 * still missing. The words here are neutral (no "ישן" / "ישנה"): anything about the baby comes from words.ts.
 */
export type QuestionId = 'gaps' | 'poop' | 'diaper' | 'night';
export type Category = 'feed' | 'sleep' | 'diaper';

export const CATEGORIES: { id: Category; icon: string; title: string }[] = [
  { id: 'feed', icon: '🍼', title: 'האכלה' },
  { id: 'sleep', icon: '🌙', title: 'שינה' },
  { id: 'diaper', icon: '💧', title: 'חיתולים' },
];

export interface Question {
  id: QuestionId;
  cat: Category;
  q: string;
  /** one line under the question in "בחירת שאלות" */
  desc: string;
  /** the key of its insight in `Insights` */
  key: 'feedGaps' | 'poopAfterFeed' | 'diaperAfterFeed' | 'nightSleep';
  /** what is still missing, e.g. "התשובה תופיע אחרי 20 רווחים בין האכלות" */
  wait: (p: Progress) => string;
  /** "איך זה מחושב?" */
  how: (mergeWindowMin: number) => string[];
}

const soFar = (p: Progress) => `עד עכשיו ${p.have}.`;

export const QUESTIONS: Question[] = [
  {
    id: 'gaps',
    cat: 'feed',
    q: 'כל כמה זמן מאכילים?',
    desc: 'הרווח הרגיל בין האכלות, ביום ובלילה',
    key: 'feedGaps',
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
    key: 'nightSleep',
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
    key: 'poopAfterFeed',
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
    key: 'diaperAfterFeed',
    wait: (p) => `התשובה תופיע אחרי ${p.need} האכלות ב-7 הימים האחרונים. ${soFar(p)}`,
    how: () => [
      'לכל האכלה ב-7 הימים המלאים האחרונים נבדק אם הוחלף חיתול (כל סוג) תוך שעה מתחילתה, וכמה זמן אחריה.',
      'תשובה מוצגת רק כשזה קורה בבירור יותר ממה שהיה קורה במקרה. אחרת התשובה היא "אין קשר ברור".',
    ],
  },
];

/** (owner) Shown under the questions and in every "איך זה מחושב?". */
export const NOT_MEDICAL =
  'כל ההשוואות הן רק מול מה שנרשם אצלכם עד עכשיו, לא מול נורמות או ערכים רפואיים. זו לא המלצה ולא ייעוץ רפואי: בכל שאלה או דאגה פנו לרופא או לטיפת חלב.';

/** Whether the question has enough data, and whether it is shown (by hand, or automatically once ready). */
export function questionState(q: Question, r: Insights, choice: 'on' | 'off' | undefined): { ready: boolean; shown: boolean } {
  const p = r.progress[q.key];
  const ready = p.have >= p.need;
  return { ready, shown: choice === 'on' || (choice === undefined && ready) };
}
