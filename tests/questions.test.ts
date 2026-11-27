import { describe, expect, it } from 'vitest';
import { DEFAULT_FEEDING } from '../src/shared/bottle';
import { QUESTIONS, allQuestions, questionState } from '../src/app/questions';

// Owner (feedback #5): every question is listed for every family; one its kinds of feeding do not offer is off by itself.
describe('allQuestions', () => {
  it('lists every question for every family, and marks the ones its kinds of feeding do not offer', () => {
    const nursing = allQuestions({ ...DEFAULT_FEEDING, breast: true, expressed: false, formula: false });
    const bottles = allQuestions({ ...DEFAULT_FEEDING, breast: false, expressed: false, formula: true });
    expect(nursing.map((q) => q.id)).toEqual(QUESTIONS.map((q) => q.id));
    expect(bottles.map((q) => q.id)).toEqual(QUESTIONS.map((q) => q.id));
    expect(nursing.filter((q) => q.fits === false).map((q) => q.id)).toEqual(['bottlesToday', 'bottleSize', 'bottleShare']);
    expect(bottles.filter((q) => q.fits === false).map((q) => q.id)).toEqual(['bottleShare', 'sides', 'cluster']);
  });

  it('a question that does not fit is never shown by itself, even with enough data; turned on by hand it is', () => {
    const q = { ...QUESTIONS[0]!, prog: () => ({ have: 5, need: 1 }), fits: false };
    const a = {} as Parameters<typeof questionState>[1];
    expect(questionState(q, a, undefined)).toEqual({ ready: true, shown: false });
    expect(questionState(q, a, 'on')).toEqual({ ready: true, shown: true });
    expect(questionState({ ...q, fits: true }, a, undefined).shown).toBe(true);
  });
});
