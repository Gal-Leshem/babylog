import { randomInt } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The families besides the owner's, each with a server of its own (a sheet with a bound Apps Script, created and updated by
 * the pipeline after production). The list lives in `families.json` and holds random ids only: the repository is public.
 *   tsx scripts/families.ts list    prints the ids, one per line
 *   tsx scripts/families.ts new     adds a new random id to families.json and prints it
 */
export const FAMILIES_FILE = 'families.json';
const ID = /^[a-z0-9]{6,12}$/;
const RESERVED = new Set(['test', 'prod']);
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i: easy to read aloud

export interface FamilyEnv {
  /** The deploy environment's name: also the file name of its ids on ci-status (`envs/<env>.json`). */
  env: string;
  /** The sheet's (and script's) title in the owner's Drive. */
  title: string;
}

export function familyEnv(id: string): FamilyEnv {
  if (!isFamilyId(id)) throw new Error('a family id is 6 to 12 lowercase letters or digits');
  return { env: `family-${id}`, title: `BabyLog ${id}` };
}

export const isFamilyId = (id: unknown): id is string => typeof id === 'string' && ID.test(id) && !RESERVED.has(id);

/** Reads and checks the list: every id valid and listed once. Throws with the reason otherwise. */
export function parseFamilies(text: string): string[] {
  const o = JSON.parse(text) as { families?: unknown };
  if (!o || !Array.isArray(o.families)) throw new Error(`${FAMILIES_FILE}: "families" must be a list`);
  const seen = new Set<string>();
  for (const id of o.families) {
    if (!isFamilyId(id)) throw new Error(`${FAMILIES_FILE}: not a valid family id: ${JSON.stringify(id)}`);
    if (seen.has(id)) throw new Error(`${FAMILIES_FILE}: listed twice: ${id}`);
    seen.add(id);
  }
  return [...seen];
}

export function newFamilyId(taken: readonly string[], rnd: (n: number) => number = randomInt): string {
  for (;;) {
    const id = Array.from({ length: 8 }, () => ALPHABET[rnd(ALPHABET.length)]).join('');
    if (isFamilyId(id) && !taken.includes(id)) return id;
  }
}

export const readFamilies = (file = FAMILIES_FILE): string[] => parseFamilies(readFileSync(file, 'utf8'));

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cmd = process.argv[2];
  if (cmd === 'list') {
    for (const id of readFamilies()) console.log(id);
  } else if (cmd === 'new') {
    const o = JSON.parse(readFileSync(FAMILIES_FILE, 'utf8')) as {
      families: string[];
    };
    const id = newFamilyId(parseFamilies(JSON.stringify(o)));
    o.families.push(id);
    writeFileSync(FAMILIES_FILE, JSON.stringify(o, null, 2) + '\n');
    console.log(id);
  } else {
    console.error('usage: tsx scripts/families.ts list|new');
    process.exit(2);
  }
}
