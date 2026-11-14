import { describe, expect, it } from 'vitest';
import { durationEn, speechAwake, speechForLogged, speechStatus, speechVitaminAgain } from '../src/shared/speech';
import { ev, T } from './helpers';

describe('Siri phrases', () => {
  it('formats durations in English', () => {
    expect(durationEn(0)).toBe('less than a minute');
    expect(durationEn(1)).toBe('1 minute');
    expect(durationEn(45)).toBe('45 minutes');
    expect(durationEn(60)).toBe('1 hour');
    expect(durationEn(85)).toBe('1 hour 25 minutes');
    expect(durationEn(130)).toBe('2 hours 10 minutes');
  });

  it('confirms a feed with the next side', () => {
    const f = ev({ type: 'feed', detail: 'left', start: '2026-11-14 03:12' });
    expect(speechForLogged(f, [f])).toBe('Logged left, 3:12. Next: right');
  });

  it('confirms diapers', () => {
    expect(speechForLogged(ev({ type: 'diaper', detail: 'wet', start: '2026-11-14 03:12' }), [])).toBe(
      'Wet diaper logged, 3:12',
    );
    expect(speechForLogged(ev({ type: 'diaper', detail: 'poop', start: '2026-11-14 13:05' }), [])).toBe(
      'Poop logged, 13:05',
    );
    expect(speechForLogged(ev({ type: 'diaper', detail: 'both', start: '2026-11-14 03:12' }), [])).toBe(
      'Full diaper logged, 3:12',
    );
  });

  it('describes wake-ups and vitamin D', () => {
    expect(speechAwake(85)).toBe('Awake. Slept 1 hour 25 minutes');
    expect(speechAwake(null)).toBe('Awake. Sleep length unknown');
    expect(speechVitaminAgain(ev({ type: 'vitamin_d', start: '2026-11-14 08:10' }))).toBe(
      'Vitamin D logged again. Already given today at 8:10',
    );
  });

  it('answers the status question', () => {
    const last = ev({ type: 'feed', detail: 'left', start: '2026-11-14 01:00' });
    expect(speechStatus(last, T('2026-11-14 03:10'))).toBe('2 hours 10 minutes ago, left side. Next: right');
    expect(speechStatus(undefined, T('2026-11-14 03:10'))).toBe('No feeds logged yet');
    expect(speechStatus(last, T('2026-11-14 01:00'))).toBe('Less than a minute ago, left side. Next: right');
  });
});
