import { useState } from 'preact/hooks';
import { NetworkError, callApi } from '../api';
import { decodeSetupCode } from '../config';
import type { Settings } from '../../shared/types';
import { engine } from '../state';

export function Install() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conn, setConn] = useState<{ url: string; key: string; settings: Settings } | null>(null);
  const [me, setMe] = useState('');
  const [names, setNames] = useState<[string, string]>(['', '']);
  const [baby, setBaby] = useState('');

  const connect = async () => {
    setError('');
    const parsed = decodeSetupCode(code);
    if (!parsed) return setError('הקוד לא תקין. העתיקו אותו שוב במלואו, כולל BL1 בהתחלה.');
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
      setError(e instanceof NetworkError ? 'אין תגובה מהשרת. בדקו חיבור לאינטרנט ושהקוד נכון. אם זה קורה תמיד, ייתכן שה-Setup עוד לא אושר.' : 'שגיאה לא צפויה');
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
        <p>הדביקו כאן את קוד ההתקנה שהודפס בסיום ה-Setup של השרת (מתחיל ב-BL1).</p>
        <textarea data-testid="setup-code" rows={5} value={code} placeholder="BL1...." onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)} />
        {error && (
          <p class="err" role="alert" data-testid="install-error">
            {error}
          </p>
        )}
        <button type="button" class="primary" data-testid="connect" disabled={busy || !code.trim()} onClick={() => void connect()}>
          {busy ? 'מתחבר…' : 'התחברות'}
        </button>
      </main>
    );
  }

  return (
    <main class="install" data-testid="install-step2">
      <h1>כמעט סיימנו</h1>
      <p>השמות נשמרים בגיליון הפרטי שלכם בלבד. אם ההורה השני כבר הגדיר אותם, הם כבר מולאו.</p>
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
