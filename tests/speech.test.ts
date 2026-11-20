import { describe, expect, it } from 'vitest';
import { durationEn, durationHe, speechAwake, speechForLogged, speechStatus, speechVitaminAgain, voiceEn, voiceFor, voiceHe } from '../src/shared/speech';
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

// Owner: Siri on the other parent's phone speaks Hebrew; words about the baby follow the sex chosen in Settings.
describe('Hebrew sentences', () => {
  it('durations read naturally', () => {
    expect([0.4, 1, 20, 60, 61, 80, 120, 121, 125, 180, 185].map(durationHe)).toEqual([
      'פחות מדקה',
      'דקה',
      '20 דקות',
      'שעה',
      'שעה ודקה',
      'שעה ו-20 דקות',
      'שעתיים',
      'שעתיים ודקה',
      'שעתיים ו-5 דקות',
      '3 שעות',
      '3 שעות ו-5 דקות',
    ]);
  });
  it('a feed, diapers, vitamin D, the next side', () => {
    const v = voiceHe(undefined);
    const f = ev({ type: 'feed', detail: 'right', start: '2026-11-14 14:10' });
    expect(v.logged(f, [f])).toBe('נרשמה הנקה ימין, 14:10. הבאה: שמאל');
    expect(v.logged(ev({ type: 'diaper', detail: 'wet', start: '2026-11-14 09:05' }), [])).toBe('נרשם חיתול פיפי, 9:05');
    expect(v.logged(ev({ type: 'diaper', detail: 'poop', start: '2026-11-14 09:05' }), [])).toBe('נרשם חיתול קקי, 9:05');
    expect(v.logged(ev({ type: 'diaper', detail: 'both', start: '2026-11-14 09:05' }), [])).toBe('נרשם חיתול פיפי וקקי, 9:05');
    expect(v.logged(ev({ type: 'vitamin_d', start: '2026-11-14 09:05' }), [])).toBe('נרשם ויטמין די להיום');
    expect(v.vitaminAgain(ev({ type: 'vitamin_d', start: '2026-11-14 08:00' }))).toBe('ויטמין די נרשם שוב. כבר ניתן היום ב-8:00');
  });
  it('sleep words follow the baby: boy (also when not chosen) and girl', () => {
    const s = ev({ type: 'sleep', start: '2026-11-14 13:00' });
    expect(voiceHe(undefined).logged(s, [s])).toBe('נרדם ב-13:00');
    expect(voiceHe('girl').logged(s, [s])).toBe('נרדמה ב-13:00');
    expect(voiceHe('boy').awake(80)).toBe('התעורר. ישן שעה ו-20 דקות');
    expect(voiceHe('girl').awake(80)).toBe('התעוררה. ישנה שעה ו-20 דקות');
    expect(voiceHe('girl').awake(null)).toBe('התעוררה. אורך השינה לא ידוע');
    expect(voiceHe('girl').alreadyAsleep(s)).toBe('כבר מסומנת כישנה מ-13:00');
    expect(voiceHe('boy').alreadyAsleep(s)).toBe('כבר מסומן כישן מ-13:00');
  });
  it('the last feed', () => {
    const f = ev({ type: 'feed', detail: 'left', start: '2026-11-14 12:30' });
    expect(voiceHe(undefined).status(f, T('2026-11-14 14:00'))).toBe('ההנקה האחרונה לפני שעה ו-30 דקות, צד שמאל. הבאה: ימין');
    expect(voiceHe(undefined).status(undefined, T('2026-11-14 14:00'))).toBe('עוד לא נרשמו הנקות');
  });
  it('a request picks its language; without one it stays English (shortcuts made before)', () => {
    expect(voiceFor('he', () => 'girl')).not.toBe(voiceEn);
    expect(voiceFor(undefined, () => 'girl')).toBe(voiceEn);
    expect(voiceFor('en', () => 'girl')).toBe(voiceEn);
  });
});
