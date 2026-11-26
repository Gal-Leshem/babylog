import { useState } from 'preact/hooks';
import { BOTTLE_MAX_ML, BOTTLE_STEP_ML, type BottleKind, bottleKindsOn, defaultMl, feedingOf } from '../../shared/bottle';
import { logBottle } from '../actions';
import { setBottleKind, useEngine, usePrefs } from '../state';
import { amountStepper } from './Amount';

/** quick amounts in the window (owner approved the mockup) */
const QUICK_ML = [60, 90, 120, 150];

const NAMES: Record<BottleKind, string> = { formula: 'תמ״ל', expressed: 'חלב שאוב' };

/**
 * (owner, F18) The bottle window: the Home button "בקבוק" when the family breastfeeds and uses both kinds of bottle. Two big
 * kind buttons (the one picked last is chosen), the amount from that kind's default with − / +, then "רישום".
 */
export function BottleWindow({ onClose }: { onClose: () => void }) {
  const { settings } = useEngine();
  const prefs = usePrefs();
  const feeding = feedingOf(settings);
  const kinds = bottleKindsOn(feeding);
  const [kind, setKind] = useState<BottleKind>(() => {
    const k = prefs.bottleKind;
    return k && kinds.includes(k) ? k : kinds[0]!;
  });
  const [ml, setMl] = useState(() => defaultMl(feeding, kind));
  const pick = (k: BottleKind) => {
    setKind(k);
    setMl(defaultMl(feeding, k)); // (owner) every bottle starts from the default of its kind
  };
  return (
    <div class="sheet-backdrop" data-testid="bottle-window" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="בקבוק">
        <h2>בקבוק</h2>
        <div class="btype" role="radiogroup">
          {kinds.map((k) => (
            <button type="button" key={k} role="radio" aria-checked={k === kind} class={k === kind ? 'on' : ''} data-testid={`bottle-kind-${k}`} onClick={() => pick(k)}>
              <span class="emo">🍼</span>
              {NAMES[k]}
            </button>
          ))}
        </div>
        <label class="fl">כמות</label>
        {amountStepper({ value: ml, min: BOTTLE_STEP_ML, max: BOTTLE_MAX_ML, testId: 'bottle-ml', label: 'כמות', onChange: setMl })}
        <div class="chips small qml">
          {QUICK_ML.map((v) => (
            <button type="button" key={v} class={`chip ${v === ml ? 'on' : ''}`} data-testid={`bottle-ml-${v}`} onClick={() => setMl(v)}>
              {v}
            </button>
          ))}
        </div>
        <p class="muted" data-testid="bottle-default">
          ברירת המחדל ל{NAMES[kind]}: {defaultMl(feeding, kind)} מ״ל · אפשר לשנות בהגדרות
        </p>
        <div class="actions">
          <button
            type="button"
            class="primary"
            data-testid="bottle-log"
            onClick={() => {
              setBottleKind(kind);
              onClose();
              logBottle(kind, ml);
            }}
          >
            רישום
          </button>
          <button type="button" data-testid="bottle-cancel" onClick={onClose}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

