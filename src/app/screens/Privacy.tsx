import type { JSX } from 'preact';

/**
 * "פרטיות ותנאים" (owner, family servers): where the data lives, who can see it, what the app's maker sees (feedback and usage counts), no
 * medical advice. True for every family, the owner's included: "מי שהפעיל עבורכם את האפליקציה" is the owner of the Google account.
 * Shown from Settings and from the install screen. Plain text, no names.
 */
const ITEMS: [string, string][] = [
  ['איפה הנתונים', 'כל מה שנרשם (הנקות, חיתולים, שינה, תרופות, והשמות שבהגדרות) נשמר בגיליון Google נפרד למשפחה שלכם, בחשבון Google של מי שהפעיל עבורכם את האפליקציה. עותק נשמר גם בטלפון, כדי שהאפליקציה תעבוד בלי רשת.'],
  ['מי יכול לראות', 'מי שיש לו את קוד ההתקנה של המשפחה (שני ההורים), ובעל חשבון Google שבו הגיליון שמור. הנתונים לא נמסרים לאף אחד אחר. אין פרסומות.'],
  // (owner, F15) usage counts, read by the app's maker; no switch (owner)
  ['סטטיסטיקת שימוש', 'כמקובל באפליקציות, נאספת אוטומטית, כחלק מהשימוש באפליקציה, סטטיסטיקה על השימוש: כמה פעמים כל הורה פתח כל מסך והשתמש בכל פעולה, בכל יום. מספרים בלבד, בלי תוכן הרישומים. היא נשמרת בגיליון של המשפחה ונקראת על ידי יוצר האפליקציה, כדי להבין מה שימושי ולשפר.'],
  ['משוב', 'מה שנכתב במסך המשוב (ויומן הסנכרון, אם מסמנים אותו) נקרא על ידי יוצר האפליקציה, כדי לתקן ולשפר.'],
  ['הקוד', 'הקוד הוא המפתח לנתונים. שלחו אותו רק להורה השני, בהודעה פרטית. אם הוא הגיע למקום אחר, בקשו קוד חדש: הישן יפסיק לעבוד.'],
  // (owner) also meant as a legal disclaimer: a log, not a medical device; no diagnosis, advice or comparison with norms
  ['בלי ייעוץ רפואי', 'האפליקציה היא יומן לרישום ולארגון בלבד. היא אינה מכשיר רפואי, אינה מאבחנת, אינה ממליצה על טיפול ואינה מחליפה רופא, טיפת חלב או איש מקצוע. הסיכומים, התובנות וההשוואות מחושבים רק מתוך מה שנרשם, ותלויים בכך שהרישום מלא ומדויק; אין בהם השוואה לנורמות או לערכים רפואיים. מינונים ומרווחים של תרופות הם מה שההורים הזינו, לפי הנחיית הרופא או העלון, והאפליקציה אינה בודקת אותם. אין לקבל החלטה רפואית על סמך האפליקציה. בכל שאלה או דאגה פנו לרופא או לטיפת חלב, ובמצב חירום חייגו 101.'],
  ['מחיקה', '"ניתוק מהחשבון" בהגדרות מוחק את הנתונים מהטלפון. למחיקת כל הנתונים מהגיליון, פנו למי שהפעיל עבורכם את האפליקציה.'],
];

/** The text itself (a plain function, so the install screen can show it inline). */
export function privacyText(): JSX.Element {
  return (
    <div class="privacy" data-testid="privacy-text">
      {ITEMS.map(([title, body]) => (
        <div key={title}>
          <h3>{title}</h3>
          <p>{body}</p>
        </div>
      ))}
      <p class="muted" data-testid="privacy-updated">
        עודכן: נובמבר 2026
      </p>
    </div>
  );
}

export function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <div data-testid="privacy">
      <div class="actions">
        <button type="button" data-testid="privacy-back" onClick={onBack}>
          חזרה להגדרות
        </button>
      </div>
      <h2>פרטיות ותנאים</h2>
      {privacyText()}
    </div>
  );
}
