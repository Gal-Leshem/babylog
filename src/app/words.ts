import type { BabySex } from '../shared/types';

/**
 * Words about the baby that differ for a boy and a girl (owner): Hebrew verbs and adjectives agree with the baby. Everything
 * else in the app is neutral. Unknown (an older sheet) = boy, the wording the app used before.
 */
export interface BabyWords {
  fellAsleep: string;
  wokeUp: string;
  asleepFor: string;
  awakeFor: string;
  stillAsleep: string;
  sleepingNow: string;
  stillMarkedAsleep: string;
  /** the button that marks the wake-up from a toast */
  markAwake: string;
  slept: string;
}

const BOY: BabyWords = {
  fellAsleep: 'נרדם',
  wokeUp: 'התעורר',
  asleepFor: 'ישן כבר',
  awakeFor: 'ער כבר',
  stillAsleep: 'עדיין ישן',
  sleepingNow: 'ישן עכשיו',
  stillMarkedAsleep: 'עדיין מסומן כישן',
  markAwake: 'לסמן שהתעורר',
  slept: 'ישן',
};

const GIRL: BabyWords = {
  fellAsleep: 'נרדמה',
  wokeUp: 'התעוררה',
  asleepFor: 'ישנה כבר',
  awakeFor: 'ערה כבר',
  stillAsleep: 'עדיין ישנה',
  sleepingNow: 'ישנה עכשיו',
  stillMarkedAsleep: 'עדיין מסומנת כישנה',
  markAwake: 'לסמן שהתעוררה',
  slept: 'ישנה',
};

export const babyWords = (sex: BabySex | undefined): BabyWords => (sex === 'girl' ? GIRL : BOY);
