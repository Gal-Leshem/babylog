import { BOTTLE_STEP_ML } from '../../shared/bottle';

/**
 * (owner, F18) An amount in ml with − and + buttons, the same everywhere (the bottle window, the edit form, Settings).
 * A plain function returning markup, not a component, like the other small pieces of the screens.
 */
export function amountStepper(p: { value: number; min: number; max: number; testId: string; onChange: (ml: number) => void; label?: string }) {
  const set = (ml: number) => p.onChange(Math.min(p.max, Math.max(p.min, ml)));
  return (
    <div class="amtpick" data-testid={p.testId} role="group" aria-label={p.label}>
      <button type="button" data-testid={`${p.testId}-minus`} aria-label={`פחות ${BOTTLE_STEP_ML} מ״ל`} disabled={p.value <= p.min} onClick={() => set(p.value - BOTTLE_STEP_ML)}>
        −{BOTTLE_STEP_ML}
      </button>
      <b data-testid={`${p.testId}-value`}>{p.value} מ״ל</b>
      <button type="button" data-testid={`${p.testId}-plus`} aria-label={`עוד ${BOTTLE_STEP_ML} מ״ל`} disabled={p.value >= p.max} onClick={() => set(p.value + BOTTLE_STEP_ML)}>
        +{BOTTLE_STEP_ML}
      </button>
    </div>
  );
}
