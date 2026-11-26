import { useState } from 'preact/hooks';
import { NetworkError, callApi } from '../api';
import { decodeSetupCode, isEditorTestUrl, isServerUrl } from '../config';
import type { Settings } from '../../shared/types';
import { engine } from '../state';
import { privacyText } from './Privacy';
import type { JSX } from 'preact';
import { storageWorks } from '../storage';
import { iosHomeScreen } from '../statusbar';

/** What to say when the phone does not keep what the app saves (here and in the banner on every screen). */
export function storageBlocked(): JSX.Element {
  return (
    <>
      הטלפון לא שומר את החיבור, ולכן האפליקציה תבקש את הקוד שוב בכל פתיחה. לתיקון: הגדרות ← אפליקציות ← <bdi>Safari</bdi> ← לכבות "חסום את כל
      העוגיות", ואז לפתוח שוב את האפליקציה ולהזין את הקוד.
    </>
  );
}

/** Opened from the home-screen icon (iPhone), or as an installed app elsewhere. */
const installedApp = (): boolean => iosHomeScreen() || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);

export function Install() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needExec, setNeedExec] = useState(false);
  const [execUrl, setExecUrl] = useState('');
  const [conn, setConn] = useState<{ url: string; key: string; settings: Settings } | null>(null);
  const [me, setMe] = useState('');
  const [names, setNames] = useState<[string, string]>(['', '']);
  const [baby, setBaby] = useState('');
  const [showPrivacy, setShowPrivacy] = useState(false);

  const connect = async () => {
    setError('');
    const decoded = decodeSetupCode(code);
    if (!decoded) return setError('הקוד לא תקין. העתיקו אותו שוב במלואו, כולל BL1 בהתחלה.');
    let parsed = decoded;
    const override = execUrl.trim();
    if (override) {
      if (!isServerUrl(override) || isEditorTestUrl(override)) return setError('הכתובת צריכה להתחיל ב-https:// ולהסתיים ב-/exec');
      parsed = { ...decoded, url: override };
    } else if (isEditorTestUrl(decoded.url)) {
      setNeedExec(true);
      return setError('הקוד מכיל כתובת בדיקה (שמסתיימת ב-/dev) שעובדת רק בתוך עורך הסקריפט ולא מהטלפון. הריצו שוב את rotateKey אחרי שהגרסה החדשה נפרסה, או הדביקו למטה את כתובת ה-Web app (שמסתיימת ב-/exec) מתוך Deploy ← Manage deployments.');
    }
    setBusy(true);
    try {
      const res = await callApi(parsed, { action: 'settings' });
      if (!res.ok) return setError(res.error === 'unauthorized' ? 'המפתח לא תקין' : 'השרת סירב');
      const settings = res.settings!;
      setConn({ ...parsed, settings });
      setNames([...settings.parents]);
      setBaby(settings.babyName);
      setMe(settings.parents[0]);
    } catch (e) {
      setError(e instanceof NetworkError ? 'אין תגובה מהשרת. בדקו את החיבור לאינטרנט ושהקוד הועתק במלואו. אם זה חוזר, פנו למי ששלח לכם את הקוד.' : 'שגיאה לא צפויה');
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    if (!conn) return;
    const [a, b] = [names[0].trim(), names[1].trim()];
    if (!a || !b || a === b || !baby.trim()) return setError('מלאו שני שמות שונים להורים ושם לתינוק');
    // "me" follows a renamed parent
    const chosen = me === conn.settings.parents[0] ? a : me === conn.settings.parents[1] ? b : me;
    engine.configure({ url: conn.url, key: conn.key, me: chosen }, conn.settings);
    const s = conn.settings;
    if (a !== s.parents[0] || b !== s.parents[1] || baby.trim() !== s.babyName) {
      engine.dispatch({ action: 'settings', set: { parents: [a, b], babyName: baby.trim() } });
    }
    void engine.refresh();
  };

  if (!conn) {
    return (
      <main class="install" data-testid="install">
        <h1>BabyLog</h1>
        <p>
          הדביקו כאן את קוד ההתקנה שקיבלתם (מתחיל ב-<bdi>BL1</bdi>).
        </p>
        {!storageWorks() && (
          <p class="err" role="alert" data-testid="install-storage">
            {storageBlocked()}
          </p>
        )}
        {/* (owner) a family entered the code only in the browser: the home-screen app keeps its own, separate storage */}
        {!installedApp() && (
          <p class="muted" data-testid="install-hint">
            הוספתם את האפליקציה למסך הבית? פתחו אותה מהאייקון והזינו את הקוד שם: היא שומרת את החיבור בנפרד מהדפדפן.
          </p>
        )}
        <textarea data-testid="setup-code" rows={5} value={code} placeholder="BL1...." onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)} />
        {needExec && (
          <>
            <label class="fl">כתובת ה-Web app (מסתיימת ב-/exec)</label>
            <input data-testid="exec-url" dir="ltr" value={execUrl} placeholder="https://script.google.com/macros/s/…/exec" onInput={(e) => setExecUrl((e.target as HTMLInputElement).value)} />
          </>
        )}
        {error && (
          <p class="err" role="alert" data-testid="install-error">
            {error}
          </p>
        )}
        <button type="button" class="primary" data-testid="connect" disabled={busy || !code.trim()} onClick={() => void connect()}>
          {busy ? 'מתחבר…' : 'התחברות'}
        </button>
        <button type="button" class="linklike" data-testid="install-privacy" onClick={() => setShowPrivacy(!showPrivacy)}>
          פרטיות ותנאים
        </button>
        {showPrivacy && privacyText()}
      </main>
    );
  }

  return (
    <main class="install" data-testid="install-step2">
      <h1>כמעט סיימנו</h1>
      <p>השמות נשמרים רק בגיליון של המשפחה שלכם. אם ההורה השני כבר הגדיר אותם, הם כבר מולאו.</p>
      <label class="fl">הורה 1</label>
      <input data-testid="name-1" value={names[0]} maxLength={20} onInput={(e) => setNames([(e.target as HTMLInputElement).value, names[1]])} />
      <label class="fl">הורה 2</label>
      <input data-testid="name-2" value={names[1]} maxLength={20} onInput={(e) => setNames([names[0], (e.target as HTMLInputElement).value])} />
      <label class="fl">שם התינוק</label>
      <input data-testid="name-baby" value={baby} maxLength={40} onInput={(e) => setBaby((e.target as HTMLInputElement).value)} />
      <label class="fl">מי אני במכשיר הזה?</label>
      <div class="chips" role="radiogroup">
        {conn.settings.parents.map((p, i) => (
          <button type="button" key={p} class={`chip ${me === p ? 'on' : ''}`} data-testid={`me-${i + 1}`} onClick={() => setMe(p)}>
            {names[i] || p}
          </button>
        ))}
      </div>
      {error && <p class="err">{error}</p>}
      <button type="button" class="primary" data-testid="finish" onClick={finish}>
        סיום
      </button>
    </main>
  );
}
