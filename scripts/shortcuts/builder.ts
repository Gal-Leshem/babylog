import { type PlistValue, toPlist } from './plist';

/**
 * Builds iOS/macOS Shortcuts files (.shortcut, as XML property lists) for BabyLog.
 *
 * Each shortcut is self-contained: it posts one request to the server and speaks the
 * answer. The server address, key and parent name are NOT in the templates: they are
 * placeholders that the Mac signing script fills in locally, so no secret is ever published.
 */
export const PLACEHOLDER = { url: '@@URL@@', key: '@@KEY@@', me: '@@ME@@' } as const;

type Dict = { [key: string]: PlistValue };
type Attach = { Type: 'ActionOutput'; OutputUUID: string; OutputName: string };

let counter = 0;
/** Deterministic ids keep the generated files stable between builds. */
const uuid = (seed: string): string => {
  counter += 1;
  const h = [...`${seed}-${counter}`].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  const a = hex(h);
  const b = hex(Math.imul(h, 2654435761));
  const c = hex(Math.imul(h, 40503) ^ 0x9e3779b9);
  const d = hex(Math.imul(h, 69069) + 1);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4)}${d.slice(0, 4)}`.toUpperCase();
};

const out = (id: string, name: string): Attach => ({ Type: 'ActionOutput', OutputUUID: id, OutputName: name });

/** Text with embedded variable references. */
function tokenString(parts: (string | Attach)[]): Dict {
  let text = '';
  const attachments: Dict = {};
  for (const p of parts) {
    if (typeof p === 'string') text += p;
    else {
      attachments[`{${text.length}, 1}`] = p as unknown as Dict;
      text += '￼';
    }
  }
  return { Value: { string: text, attachmentsByRange: attachments }, WFSerializationType: 'WFTextTokenString' };
}

/** A parameter that is exactly one variable. */
const attachment = (a: Attach): Dict => ({ Value: a as unknown as Dict, WFSerializationType: 'WFTextTokenAttachment' });

type Item = [key: string, value: string | Attach | (string | Attach)[]];
function jsonFields(items: Item[]): Dict {
  return {
    Value: {
      WFDictionaryFieldValueItems: items.map(([k, v]) => ({
        WFItemType: 0,
        WFKey: tokenString([k]),
        WFValue: tokenString(Array.isArray(v) ? v : [v]),
      })),
    },
    WFSerializationType: 'WFDictionaryFieldValue',
  };
}

interface Action {
  WFWorkflowActionIdentifier: string;
  WFWorkflowActionParameters: Dict;
}
const action = (id: string, params: Dict): Action => ({ WFWorkflowActionIdentifier: `is.workflow.actions.${id}`, WFWorkflowActionParameters: params });

export interface ShortcutSpec {
  /** File and Siri phrase. English, because Siri runs in English here. */
  name: string;
  request: { action: string; type: string; detail: string };
  /** Icon colour (ARGB) and glyph. */
  color: number;
  glyph: number;
}

export const SHORTCUTS: ShortcutSpec[] = [
  { name: 'Left feed', request: { action: 'log', type: 'feed', detail: 'left' }, color: 463140863, glyph: 59445 },
  { name: 'Right feed', request: { action: 'log', type: 'feed', detail: 'right' }, color: 463140863, glyph: 59445 },
  { name: 'Wet diaper', request: { action: 'log', type: 'diaper', detail: 'wet' }, color: 946986751, glyph: 59447 },
  { name: 'Poop', request: { action: 'log', type: 'diaper', detail: 'poop' }, color: 4282601983, glyph: 59447 },
  { name: 'Full diaper', request: { action: 'log', type: 'diaper', detail: 'both' }, color: 4271458815, glyph: 59447 },
  { name: 'Asleep', request: { action: 'asleep', type: '-', detail: '-' }, color: 255, glyph: 59444 },
  { name: 'Awake', request: { action: 'awake', type: '-', detail: '-' }, color: 4292093695, glyph: 59444 },
  { name: 'Vitamin D', request: { action: 'log', type: 'vitamin_d', detail: '-' }, color: 4274264319, glyph: 59446 },
  { name: 'Last feed', request: { action: 'status', type: '-', detail: '-' }, color: 3031607807, glyph: 59448 },
];

export const FAILURE_PHRASE = 'BabyLog failed. Nothing was saved.';

export function buildActions(spec: ShortcutSpec): Action[] {
  counter = 0;
  const now = uuid(`${spec.name}:now`);
  const stamp = uuid(`${spec.name}:stamp`);
  const stampId = uuid(`${spec.name}:stampId`);
  const rnd = uuid(`${spec.name}:rnd`);
  const rid = uuid(`${spec.name}:rid`);
  const post = uuid(`${spec.name}:post`);
  const dict = uuid(`${spec.name}:dict`);
  const speech = uuid(`${spec.name}:speech`);
  const group = uuid(`${spec.name}:group`);

  return [
    action('date', { UUID: now, WFDateActionMode: 'Current Date' }),
    // the time of the event, in the format the server expects
    action('format.date', { UUID: stamp, WFDate: attachment(out(now, 'Date')), WFDateFormatStyle: 'Custom', WFDateFormat: 'yyyy-MM-dd HH:mm' }),
    // a unique request id (retries of the same request are recognised by the server)
    action('format.date', { UUID: stampId, WFDate: attachment(out(now, 'Date')), WFDateFormatStyle: 'Custom', WFDateFormat: 'yyyyMMddHHmmssSSS' }),
    action('number.random', { UUID: rnd, WFRandomNumberMinimum: 100000, WFRandomNumberMaximum: 999999 }),
    action('gettext', { UUID: rid, WFTextActionText: tokenString(['siri-', out(stampId, 'Formatted Date'), '-', out(rnd, 'Random Number')]) }),
    action('downloadurl', {
      UUID: post,
      WFURL: PLACEHOLDER.url,
      WFHTTPMethod: 'POST',
      WFHTTPBodyType: 'JSON',
      Advanced: true,
      ShowHeaders: false,
      WFJSONValues: jsonFields([
        ['key', PLACEHOLDER.key],
        ['action', spec.request.action],
        ['id', out(rid, 'Text')],
        ['type', spec.request.type],
        ['detail', spec.request.detail],
        ['start', out(stamp, 'Formatted Date')],
        ['user', PLACEHOLDER.me],
        ['source', 'siri'],
      ]),
    }),
    action('detect.dictionary', { UUID: dict, WFInput: attachment(out(post, 'Contents of URL')) }),
    action('getvalueforkey', { UUID: speech, WFInput: attachment(out(dict, 'Dictionary')), WFDictionaryKey: 'speech', WFGetDictionaryValueType: 'Value' }),
    // success: say what the server said; otherwise say that nothing was saved
    action('conditional', {
      GroupingIdentifier: group,
      WFControlFlowMode: 0,
      WFCondition: 'Has Any Value',
      WFInput: { Type: 'Variable', Variable: attachment(out(speech, 'Dictionary Value')) },
    }),
    action('speaktext', { WFText: tokenString([out(speech, 'Dictionary Value')]), WFSpeakTextWait: true }),
    action('conditional', { GroupingIdentifier: group, WFControlFlowMode: 1 }),
    action('speaktext', { WFText: tokenString([FAILURE_PHRASE]), WFSpeakTextWait: true }),
    action('conditional', { GroupingIdentifier: group, WFControlFlowMode: 2, UUID: uuid(`${spec.name}:end`) }),
  ];
}

export function buildShortcut(spec: ShortcutSpec): string {
  return toPlist({
    WFWorkflowClientVersion: '2900.0.1',
    WFWorkflowClientRelease: '18.0',
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowIcon: { WFWorkflowIconStartColor: spec.color, WFWorkflowIconGlyphNumber: spec.glyph },
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: [],
    WFWorkflowInputContentItemClasses: [],
    WFWorkflowHasShortcutInputVariables: false,
    WFWorkflowActions: buildActions(spec) as unknown as PlistValue[],
  });
}
