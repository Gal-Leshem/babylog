import plist from 'plist';
import { formatLocal } from '../src/shared/tz';

/**
 * A tiny interpreter for the Shortcuts actions BabyLog uses. It runs the generated files the way
 * Shortcuts is documented to, so reference mistakes, wrong ordering and wrong parameter shapes are caught.
 * It throws on any action it does not know, which keeps the generator inside the verified subset.
 */
export const KNOWN_ACTIONS = [
  'date',
  'format.date',
  'number.random',
  'gettext',
  'downloadurl',
  'detect.dictionary',
  'getvalueforkey',
  'conditional',
  'choosefrommenu',
  'showresult',
].map((a) => `is.workflow.actions.${a}`);

type Obj = Record<string, any>;
export interface Env {
  now: number;
  random: () => number;
  /** Performs the HTTP request; may throw to simulate no connection. */
  http: (url: string, body: string, method: string) => Promise<string>;
  /** What the parent answers to a "choose from menu" question (Siri asks it aloud); missing: the shortcut is cancelled. */
  choose?: (prompt: string, items: string[]) => string | undefined;
}

export function parseShortcut(xml: string): Obj {
  return plist.parse(xml) as Obj;
}

export function formatDate(epoch: number, pattern: string): string {
  const [date, time] = formatLocal(epoch).split(' ') as [string, string];
  const [y, mo, d] = date.split('-') as [string, string, string];
  const [h, mi] = time.split(':') as [string, string];
  const s = String(Math.floor(epoch / 1000) % 60).padStart(2, '0');
  const ms = String(epoch % 1000).padStart(3, '0');
  return pattern.replace('yyyy', y).replace('MM', mo).replace('dd', d).replace('HH', h).replace('mm', mi).replace('ss', s).replace('SSS', ms);
}

export async function runShortcut(xml: string, env: Env): Promise<{ spoken: string[]; asked: string[] }> {
  const wf = parseShortcut(xml);
  const actions = wf.WFWorkflowActions as Obj[];
  const outputs = new Map<string, unknown>();
  const spoken: string[] = [];
  const asked: string[] = [];
  type Frame = { group: string; kind: 'if'; taken: boolean; inElse: boolean } | { group: string; kind: 'menu'; chosen: string | undefined; current: string | null };
  const frames: Frame[] = [];
  const active = () => frames.every((f) => (f.kind === 'if' ? (f.taken && !f.inElse) || (!f.taken && f.inElse) : f.current !== null && f.current === f.chosen));

  const lookup = (a: Obj): unknown => {
    if (a.Type !== 'ActionOutput') throw new Error(`unsupported variable type ${a.Type}`);
    if (!outputs.has(a.OutputUUID)) throw new Error(`reference to an output that does not exist (yet): ${a.OutputUUID}`);
    return outputs.get(a.OutputUUID);
  };
  const resolve = (p: unknown): unknown => {
    if (typeof p === 'string') return p;
    const o = p as Obj;
    if (o.WFSerializationType === 'WFTextTokenAttachment') return lookup(o.Value);
    if (o.WFSerializationType === 'WFTextTokenString') {
      const str: string = o.Value.string;
      const byRange: Obj = o.Value.attachmentsByRange;
      let result = '';
      for (let i = 0; i < str.length; i++) {
        const att = byRange[`{${i}, 1}`];
        if (str[i] === '￼') {
          if (!att) throw new Error(`placeholder at ${i} without attachment`);
          const v = lookup(att);
          result += v === undefined ? '' : String(v);
        } else result += str[i];
      }
      for (const key of Object.keys(byRange)) {
        const pos = Number(/\{(\d+),/.exec(key)![1]);
        if (str[pos] !== '￼') throw new Error(`attachment at ${pos} does not sit on a placeholder`);
      }
      return result;
    }
    throw new Error(`cannot resolve ${JSON.stringify(p)}`);
  };

  for (const act of actions) {
    const id = act.WFWorkflowActionIdentifier as string;
    const p = act.WFWorkflowActionParameters as Obj;
    if (!KNOWN_ACTIONS.includes(id)) throw new Error(`unknown action ${id}`);

    if (id.endsWith('.conditional')) {
      const mode = p.WFControlFlowMode as number;
      if (mode === 0) {
        let taken = false;
        if (active()) {
          if (p.WFCondition !== 'Has Any Value') throw new Error(`unsupported condition ${p.WFCondition}`);
          const input = p.WFInput as Obj;
          if (input.Type !== 'Variable') throw new Error('condition input must be a variable');
          const v = resolve(input.Variable);
          taken = v !== undefined && v !== null && v !== '';
        }
        frames.push({ group: p.GroupingIdentifier, kind: 'if', taken, inElse: false });
      } else if (mode === 1) {
        const f = frames[frames.length - 1];
        if (!f || f.group !== p.GroupingIdentifier || f.kind !== 'if') throw new Error('else without matching if');
        f.inElse = true;
      } else {
        const f = frames.pop();
        if (!f || f.group !== p.GroupingIdentifier || f.kind !== 'if') throw new Error('end without matching if');
      }
      continue;
    }
    if (id.endsWith('.choosefrommenu')) {
      const mode = p.WFControlFlowMode as number;
      if (mode === 0) {
        const items = p.WFMenuItems as string[];
        if (!Array.isArray(items) || !items.every((x) => typeof x === 'string')) throw new Error('menu items must be plain titles');
        if (new Set(items).size !== items.length) throw new Error('menu titles must be unique');
        let chosen: string | undefined;
        if (active()) {
          asked.push(String(p.WFMenuPrompt));
          chosen = env.choose?.(String(p.WFMenuPrompt), items);
          if (chosen !== undefined && !items.includes(chosen)) throw new Error(`"${chosen}" is not on the menu`);
        }
        frames.push({ group: p.GroupingIdentifier, kind: 'menu', chosen, current: null });
      } else if (mode === 1) {
        const f = frames[frames.length - 1];
        if (!f || f.group !== p.GroupingIdentifier || f.kind !== 'menu') throw new Error('menu item without its menu');
        f.current = String(p.WFMenuItemTitle);
      } else {
        const f = frames.pop();
        if (!f || f.group !== p.GroupingIdentifier || f.kind !== 'menu') throw new Error('menu end without its menu');
      }
      continue;
    }
    if (!active()) continue;

    switch (id.replace('is.workflow.actions.', '')) {
      case 'date':
        if (p.WFDateActionMode !== 'Current Date') throw new Error('only the current date is supported');
        outputs.set(p.UUID, env.now);
        break;
      case 'format.date':
        if (p.WFDateFormatStyle !== 'Custom') throw new Error('only custom date formats are supported');
        outputs.set(p.UUID, formatDate(resolve(p.WFDate) as number, p.WFDateFormat));
        break;
      case 'number.random':
        outputs.set(p.UUID, p.WFRandomNumberMinimum + Math.floor(env.random() * (p.WFRandomNumberMaximum - p.WFRandomNumberMinimum + 1)));
        break;
      case 'gettext':
        outputs.set(p.UUID, resolve(p.WFTextActionText));
        break;
      case 'downloadurl': {
        if (p.WFHTTPBodyType !== 'JSON') throw new Error('only JSON bodies are supported');
        const body: Obj = {};
        for (const item of p.WFJSONValues.Value.WFDictionaryFieldValueItems as Obj[]) {
          if (item.WFItemType !== 0) throw new Error('only text fields are supported');
          body[String(resolve(item.WFKey))] = String(resolve(item.WFValue));
        }
        outputs.set(p.UUID, await env.http(String(resolve(p.WFURL)), JSON.stringify(body), p.WFHTTPMethod));
        break;
      }
      case 'detect.dictionary':
        outputs.set(p.UUID, JSON.parse(String(resolve(p.WFInput))));
        break;
      case 'getvalueforkey':
        outputs.set(p.UUID, (resolve(p.WFInput) as Obj)[p.WFDictionaryKey]);
        break;
      case 'showresult':
        spoken.push(String(resolve(p.Text)));
        break;
    }
  }
  if (frames.length) throw new Error('unclosed if or menu');
  return { spoken, asked };
}
