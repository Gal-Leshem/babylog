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

type Req = { action: string; type: string; detail: string };
export type Lang = 'en' | 'he';

export interface ShortcutSpec {
  /** The shortcut's name, which is also what is said to Siri ("Hey Siri, <name>"). */
  name: string;
  /** Siri's language on the phone it is for: the server answers in it (`lang`), and only that set works by voice. */
  lang: Lang;
  /** Only for a baby of this sex (Hebrew sleep words); missing: any. The signing script keeps the ones that fit. */
  sex?: 'boy' | 'girl';
  /** One request... */
  request?: Req;
  /** ...or a question first (owner's option B): Siri asks, the parent answers with one of the items. */
  menu?: { prompt: string; items: { title: string; request: Req }[] };
  /** Icon colour (ARGB) and glyph. */
  color: number;
  glyph: number;
}

const FEED = { color: 463140863, glyph: 59445 };
const DIAPER = { color: 946986751, glyph: 59447 };
const SLEEP = { color: 255, glyph: 59444 };
const VIT = { color: 4274264319, glyph: 59446 };
const ASK = { color: 3031607807, glyph: 59448 };

const R = {
  left: { action: 'log', type: 'feed', detail: 'left' },
  right: { action: 'log', type: 'feed', detail: 'right' },
  wet: { action: 'log', type: 'diaper', detail: 'wet' },
  poop: { action: 'log', type: 'diaper', detail: 'poop' },
  both: { action: 'log', type: 'diaper', detail: 'both' },
  asleep: { action: 'asleep', type: '-', detail: '-' },
  awake: { action: 'awake', type: '-', detail: '-' },
  vitamin: { action: 'log', type: 'vitamin_d', detail: '-' },
  status: { action: 'status', type: '-', detail: '-' },
} satisfies Record<string, Req>;

/** Hebrew sleep shortcuts and the Hebrew question, in the baby's wording (owner: words follow the sex chosen in Settings). */
const heSleep = (sex: 'boy' | 'girl'): ShortcutSpec[] => {
  const g = sex === 'girl';
  return [
    { name: g ? 'התינוקת נרדמה' : 'התינוק נרדם', lang: 'he', sex, request: R.asleep, ...SLEEP },
    { name: g ? 'התינוקת התעוררה' : 'התינוק התעורר', lang: 'he', sex, request: R.awake, ...SLEEP },
    {
      name: 'יומן תינוק',
      lang: 'he',
      sex,
      menu: {
        prompt: 'מה לרשום?',
        items: [
          { title: 'הנקה ימין', request: R.right },
          { title: 'הנקה שמאל', request: R.left },
          { title: 'פיפי', request: R.wet },
          { title: 'קקי', request: R.poop },
          { title: 'פיפי וקקי', request: R.both },
          { title: g ? 'נרדמה' : 'נרדם', request: R.asleep },
          { title: g ? 'התעוררה' : 'התעורר', request: R.awake },
          { title: 'ויטמין די', request: R.vitamin },
        ],
      },
      ...ASK,
    },
  ];
};

/**
 * Every shortcut, in both languages (owner: one parent's Siri speaks English, the other's Hebrew). Several names for the same
 * request are separate shortcuts: Siri matches what is said against the names, so each phrasing needs its own.
 */
export const SHORTCUTS: ShortcutSpec[] = [
  { name: 'Left feed', lang: 'en', request: R.left, ...FEED },
  { name: 'Log left feed', lang: 'en', request: R.left, ...FEED },
  { name: 'Right feed', lang: 'en', request: R.right, ...FEED },
  { name: 'Log right feed', lang: 'en', request: R.right, ...FEED },
  { name: 'Wet diaper', lang: 'en', request: R.wet, ...DIAPER },
  { name: 'Poop', lang: 'en', request: R.poop, ...DIAPER },
  { name: 'Poop diaper', lang: 'en', request: R.poop, ...DIAPER },
  { name: 'Full diaper', lang: 'en', request: R.both, ...DIAPER },
  { name: 'Asleep', lang: 'en', request: R.asleep, ...SLEEP },
  { name: 'Awake', lang: 'en', request: R.awake, ...SLEEP },
  { name: 'Vitamin D', lang: 'en', request: R.vitamin, ...VIT },
  { name: 'Last feed', lang: 'en', request: R.status, ...ASK },
  {
    name: 'Baby log',
    lang: 'en',
    menu: {
      prompt: 'What should I log?',
      items: [
        { title: 'Right feed', request: R.right },
        { title: 'Left feed', request: R.left },
        { title: 'Wet diaper', request: R.wet },
        { title: 'Poop', request: R.poop },
        { title: 'Full diaper', request: R.both },
        { title: 'Asleep', request: R.asleep },
        { title: 'Awake', request: R.awake },
        { title: 'Vitamin D', request: R.vitamin },
      ],
    },
    ...ASK,
  },
  { name: 'הנקה ימין', lang: 'he', request: R.right, ...FEED },
  { name: 'תסמני הנקה ימין', lang: 'he', request: R.right, ...FEED },
  { name: 'הנקה שמאל', lang: 'he', request: R.left, ...FEED },
  { name: 'תסמני הנקה שמאל', lang: 'he', request: R.left, ...FEED },
  { name: 'חיתול פיפי', lang: 'he', request: R.wet, ...DIAPER },
  { name: 'חיתול קקי', lang: 'he', request: R.poop, ...DIAPER },
  { name: 'חיתול מלא', lang: 'he', request: R.both, ...DIAPER },
  ...heSleep('boy'),
  ...heSleep('girl'),
  { name: 'ויטמין די', lang: 'he', request: R.vitamin, ...VIT },
  { name: 'מתי הנקה אחרונה', lang: 'he', request: R.status, ...ASK },
];

/** What Siri says when the server could not be reached or refused (the server's own sentence otherwise). */
export const FAILURE: Record<Lang, string> = {
  en: 'BabyLog failed. Nothing was saved.',
  he: 'לא נשמר. נסו שוב או רשמו באפליקציה.',
};
export const FAILURE_PHRASE = FAILURE.en;

/** The time stamp and a fresh request id, made once at the start of a shortcut. */
function prelude(seed: string): { actions: Action[]; stamp: string; rid: string } {
  const now = uuid(`${seed}:now`);
  const stamp = uuid(`${seed}:stamp`);
  const stampId = uuid(`${seed}:stampId`);
  const rnd = uuid(`${seed}:rnd`);
  const rid = uuid(`${seed}:rid`);
  return {
    stamp,
    rid,
    actions: [
      action('date', { UUID: now, WFDateActionMode: 'Current Date' }),
      // the time of the event, in the format the server expects
      action('format.date', { UUID: stamp, WFDate: attachment(out(now, 'Date')), WFDateFormatStyle: 'Custom', WFDateFormat: 'yyyy-MM-dd HH:mm' }),
      // a unique request id (retries of the same request are recognised by the server)
      action('format.date', { UUID: stampId, WFDate: attachment(out(now, 'Date')), WFDateFormatStyle: 'Custom', WFDateFormat: 'yyyyMMddHHmmssSSS' }),
      action('number.random', { UUID: rnd, WFRandomNumberMinimum: 100000, WFRandomNumberMaximum: 999999 }),
      action('gettext', { UUID: rid, WFTextActionText: tokenString(['siri-', out(stampId, 'Formatted Date'), '-', out(rnd, 'Random Number')]) }),
    ],
  };
}

/**
 * One request to the server and its answer. The answer is handed to Siri as the shortcut's result ("Show Result"): Siri says
 * it in its own voice and language when the shortcut was started by voice, and shows it quietly when it was tapped.
 */
function requestActions(seed: string, req: Req, lang: Lang, p: { stamp: string; rid: string }): Action[] {
  const post = uuid(`${seed}:post`);
  const dict = uuid(`${seed}:dict`);
  const speech = uuid(`${seed}:speech`);
  const group = uuid(`${seed}:group`);
  return [
    action('downloadurl', {
      UUID: post,
      WFURL: PLACEHOLDER.url,
      WFHTTPMethod: 'POST',
      WFHTTPBodyType: 'JSON',
      Advanced: true,
      ShowHeaders: false,
      WFJSONValues: jsonFields([
        ['key', PLACEHOLDER.key],
        ['action', req.action],
        ['id', out(p.rid, 'Text')],
        ['type', req.type],
        ['detail', req.detail],
        ['start', out(p.stamp, 'Formatted Date')],
        ['user', PLACEHOLDER.me],
        ['source', 'siri'],
        ['lang', lang],
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
    action('showresult', { Text: tokenString([out(speech, 'Dictionary Value')]) }),
    action('conditional', { GroupingIdentifier: group, WFControlFlowMode: 1 }),
    action('showresult', { Text: tokenString([FAILURE[lang]]) }),
    action('conditional', { GroupingIdentifier: group, WFControlFlowMode: 2, UUID: uuid(`${seed}:end`) }),
  ];
}

export function buildActions(spec: ShortcutSpec): Action[] {
  counter = 0;
  const p = prelude(spec.name);
  if (spec.request) return [...p.actions, ...requestActions(spec.name, spec.request, spec.lang, p)];
  const menu = spec.menu!;
  const group = uuid(`${spec.name}:menu`);
  return [
    ...p.actions,
    action('choosefrommenu', { GroupingIdentifier: group, WFControlFlowMode: 0, WFMenuPrompt: menu.prompt, WFMenuItems: menu.items.map((i) => i.title) }),
    ...menu.items.flatMap((item) => [
      action('choosefrommenu', { GroupingIdentifier: group, WFControlFlowMode: 1, WFMenuItemTitle: item.title }),
      ...requestActions(`${spec.name}:${item.title}`, item.request, spec.lang, p),
    ]),
    action('choosefrommenu', { GroupingIdentifier: group, WFControlFlowMode: 2, UUID: uuid(`${spec.name}:menuend`) }),
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
