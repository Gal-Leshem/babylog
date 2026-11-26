/// <reference types="google-apps-script" />
import { BOTTLE_MAX_ML, BOTTLE_MIN_ML, DEFAULT_FEEDING, type Feeding } from '../shared/bottle';
import { type Medicine, normalizeMedicine } from '../shared/medicines';
import { API_VERSION, type FeedbackItem, type FeedbackKind, type UsageTotal } from '../shared/protocol';
import { QUESTION_STATES, USAGE_LABELS, USAGE_QUESTIONS, type UsageDay, questionColumn } from '../shared/usage';
import { TZ_NAME, formatLocal, parseLocal } from '../shared/tz';
import { type BabyEvent, DEFAULT_SETTINGS, type EventType, type Settings, type Source } from '../shared/types';
import { encodeAdminCode, encodeInstallCode, makeCheckKey } from './auth';
import { type Deps, type Store, handle } from './core';
import { type Change, type Since, parseJournal, record, since } from './journal';
import { README_ROWS } from './readme';

/** Replaced at build time. Non-empty only in the TEST build. */
declare const __FIXED_KEY__: string;
/**
 * The deployed web app address (ends in /exec), embedded by the deploy pipeline. Needed because
 * ScriptApp.getService().getUrl() returns the editor's private /dev address when run from the editor.
 */
declare const __EXEC_URL__: string;
/** The commit this bundle was built from (replaced at build time). */
declare const __BUILD__: string;
/** 'family' for a family's server (see families.ts), 'owner' for the owner's and the test server (replaced at build time). */
declare const __ROLE__: string;
const FAMILY = __ROLE__ === 'family';

const EVENTS = 'Events';
const SETTINGS = 'Settings';
const README = 'קרא אותי';
const MEDICINES = 'Medicines';
/** One row per medicine besides vitamin D; numbers that do not apply to the schedule are left empty. */
const MED_HEADER = ['id', 'name', 'dose', 'schedule', 'times_per_day', 'every_hours', 'min_gap_hours', 'max_per_day', 'course', 'course_count', 'status', 'created', 'icon', 'dose_unit', 'course_until'];
// new columns are only ever appended (rows from older versions still read); 'prev' = the event before its last edit
const HEADER = ['id', 'type', 'detail', 'start', 'end', 'user', 'source', 'note', 'created', 'edited', 'deleted', 'prev'];
const COLS = HEADER.length;
const DATE_FORMAT = 'yyyy-mm-dd hh:mm';
/** (owner) Feedback: its own tab, readable in the sheet (the kind in Hebrew). The number comes from `FEEDBACK_SEQ`. */
const FEEDBACK = 'משוב';
const FB_HEADER = ['מספר', 'נוצר', 'מי', 'סוג', 'טקסט', 'גרסה', 'יומן סנכרון', 'id'];
const FB_KIND: Record<FeedbackKind, string> = { bug: 'באג', idea: 'רעיון', other: 'אחר' };
/** A cell that starts with = + - or @ would be taken as a formula: an apostrophe in front keeps it text (Sheets hides it). */
// (owner, F15) usage counts: one row per day, parent and phone; a column per counter (new counters get a column at the end)
const USAGE = 'שימוש';
const USAGE_FIXED = ['תאריך', 'הורה', 'מכשיר', 'גרסה', 'עודכן'];
const asText = (t: string): string => (/^[=+\-@]/.test(t) ? `'${t}` : t);
const fromText = (v: unknown): string => String(v ?? '').replace(/^'(?=[=+\-@])/, '');

function toLocal(v: unknown): string {
  if (v instanceof Date) return formatLocal(v.getTime());
  return v === null || v === undefined ? '' : String(v);
}
function toCell(s: string): Date | string {
  if (!s) return '';
  const t = parseLocal(s);
  return Number.isNaN(t) ? s : new Date(t);
}
function rowToEvent(r: unknown[]): BabyEvent {
  return {
    id: String(r[0] ?? ''),
    type: String(r[1] ?? '') as EventType,
    detail: String(r[2] ?? ''),
    start: toLocal(r[3]),
    end: toLocal(r[4]),
    user: String(r[5] ?? ''),
    source: String(r[6] ?? 'app') as Source,
    note: String(r[7] ?? ''),
    created: toLocal(r[8]),
    edited: toLocal(r[9]),
    deleted: r[10] === true || String(r[10]).toUpperCase() === 'TRUE',
    prev: String(r[11] ?? ''),
  };
}
function eventToRow(e: BabyEvent): unknown[] {
  return [e.id, e.type, e.detail, toCell(e.start), toCell(e.end), e.user, e.source, e.note, toCell(e.created), toCell(e.edited), e.deleted, e.prev ?? ''];
}

/** Where this request spent its time: milliseconds per kind of work, and "<kind>#" = number of calls. Sent back with `debug: true`. */
let spent: Record<string, number> = {};
function timed<T>(kind: string, fn: () => T): T {
  const t0 = Date.now();
  try {
    return fn();
  } finally {
    spent[kind] = (spent[kind] ?? 0) + (Date.now() - t0);
    spent[`${kind}#`] = (spent[`${kind}#`] ?? 0) + 1;
  }
}

/** (F18) The feeding settings from the Settings tab, or nothing when they were never set (or were broken by hand). */
function feedingFrom(map: Record<string, string>): { feeding?: Feeding } {
  const on = (v: string | undefined) => (v === 'true' || v === 'TRUE' ? true : v === 'false' || v === 'FALSE' ? false : null);
  const f = { breast: on(map.feedBreast), expressed: on(map.feedExpressed), formula: on(map.feedFormula) };
  if (f.breast === null || f.expressed === null || f.formula === null || !(f.breast || f.expressed || f.formula)) return {};
  const ml = (v: string | undefined, d: number) => {
    const n = Number(v);
    return v !== '' && Number.isInteger(n) && n >= BOTTLE_MIN_ML && n <= BOTTLE_MAX_ML ? n : d;
  };
  return { feeding: { breast: f.breast, expressed: f.expressed, formula: f.formula, expressedMl: ml(map.mlExpressed, DEFAULT_FEEDING.expressedMl), formulaMl: ml(map.mlFormula, DEFAULT_FEEDING.formulaMl) } };
}

class SheetStore implements Store {
  private ss = timed('open', () => SpreadsheetApp.getActive());

  /**
   * (owner's sync log 3: 0.5 to 2.8 s of a tap was not timed) The Events tab and its row count are looked up once per request:
   * each is a call to Google, and on the real sheet the first of them is where the spreadsheet actually loads ('sheet').
   */
  private eventsTab: GoogleAppsScript.Spreadsheet.Sheet | null = null;
  private lastRowSeen: number | null = null;
  private events(): GoogleAppsScript.Spreadsheet.Sheet {
    return (this.eventsTab ??= timed('sheet', () => this.ss.getSheetByName(EVENTS)) ?? fatal('Events sheet missing: run setup()'));
  }
  private lastRow(): number {
    return (this.lastRowSeen ??= timed('sheet', () => this.events().getLastRow()));
  }
  /** Taking the lock: another request may have appended rows while this one waited, so the row count is read again. */
  locked(): void {
    this.lastRowSeen = null;
  }
  private read(fromRow: number): BabyEvent[] {
    const sh = this.events();
    const last = this.lastRow();
    if (last < 2) return [];
    const start = Math.max(2, fromRow);
    const values = timed('read', () => sh.getRange(start, 1, last - start + 1, COLS).getValues());
    const out: BabyEvent[] = [];
    values.forEach((r, i) => {
      if (r[0] === '') return;
      const e = rowToEvent(r);
      this.rows.set(e.id, start + i); // a row read is a row found: an edit of it needs no search of the whole sheet
      out.push(e);
    });
    return out;
  }
  recent(n: number): BabyEvent[] {
    return this.read(this.lastRow() - n + 1);
  }
  all(): BabyEvent[] {
    return this.read(2);
  }
  count(): number {
    return Math.max(0, this.lastRow() - 1);
  }
  /** The 'prev' column has its title (checked once per request, only when an edit needs it). */
  private prevTitled = false;
  /** Rows found in this request (rows never move: events are only appended or rewritten in place). */
  private rows = new Map<string, number>();
  private rowOf(id: string): number {
    const seen = this.rows.get(id);
    if (seen) return seen;
    const hit = timed('find', () => this.events().getRange('A2:A').createTextFinder(id).matchEntireCell(true).matchCase(true).findNext());
    const row = hit ? hit.getRow() : 0;
    if (row) this.rows.set(id, row);
    return row;
  }
  find(id: string): BabyEvent | undefined {
    const row = this.rowOf(id);
    if (!row) return undefined;
    return rowToEvent(this.events().getRange(row, 1, 1, COLS).getValues()[0]!);
  }
  append(e: BabyEvent): void {
    const sh = this.events();
    const last = this.lastRow();
    timed('write', () => {
      sh.appendRow(eventToRow(e));
      SpreadsheetApp.flush();
    });
    this.lastRowSeen = last + 1; // appendRow writes right after the last row with content
    this.rows.set(e.id, last + 1);
  }
  replace(e: BabyEvent): boolean {
    const row = this.rowOf(e.id);
    if (!row) return false;
    timed('write', () => {
      // a sheet made before the 'prev' column existed gets its title the first time an edit needs it
      if (e.prev && !this.prevTitled) {
        const title = this.events().getRange(1, COLS);
        if (title.getValue() !== HEADER[COLS - 1]) title.setValue(HEADER[COLS - 1]!).setFontWeight('bold');
        this.prevTitled = true;
      }
      this.events().getRange(row, 1, 1, COLS).setValues([eventToRow(e)]);
      SpreadsheetApp.flush();
    });
    return true;
  }
  /**
   * Reading the Settings and Medicines tabs is the slowest thing a list does (measured: 0.5 to 2 s), and they change rarely.
   * So the settings are also kept as one script property, which arrives with the properties every request reads anyway.
   * The copy is valid only for the settings version it was read at (`SETTINGS_REV`, moved by every save), so a reader that
   * raced with a save can never leave an old copy behind. The sheet stays the store; a hand edit of those two tabs is picked
   * up by running setup() again.
   */
  getSettings(): Settings {
    const ver = P().SETTINGS_REV ?? '0';
    try {
      const c = JSON.parse(P().SETTINGS_JSON ?? 'null') as { v?: string; s?: Settings } | null;
      if (c && c.v === ver && c.s && Array.isArray(c.s.medicines) && Array.isArray(c.s.parents)) return c.s;
    } catch {
      /* unreadable copy: read the sheet */
    }
    const s = timed('settings', () => this.readSettings());
    const json = JSON.stringify({ v: ver, s });
    if (json.length <= SETTINGS_CACHE_MAX) {
      try {
        timed('props', () => props().setProperty('SETTINGS_JSON', json));
        P().SETTINGS_JSON = json;
      } catch {
        /* no copy this time: the sheet was read, the answer is right */
      }
    }
    return s;
  }
  /** Straight from the sheet (setup uses it, so a hand edit can be taken in). */
  readSettings(): Settings {
    const sh = this.ss.getSheetByName(SETTINGS);
    const map: Record<string, string> = {};
    if (sh && sh.getLastRow() >= 1) {
      for (const [k, v] of sh.getRange(1, 1, sh.getLastRow(), 2).getValues()) {
        // a date typed into the sheet by hand comes back as a Date: keep it a plain day
        const d = v as { getTime?: () => number } | null;
        map[String(k)] = d && typeof d === 'object' && typeof d.getTime === 'function' ? formatLocal(d.getTime()).slice(0, 10) : String(v);
      }
    }
    const win = Number(map.mergeWindowMin);
    return {
      babyName: map.babyName || DEFAULT_SETTINGS.babyName,
      ...(map.babySex === 'girl' || map.babySex === 'boy' ? { babySex: map.babySex } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(map.babyBirth?.replace(/^'/, '') ?? '') ? { babyBirth: map.babyBirth!.replace(/^'/, '') } : {}),
      mergeWindowMin: Number.isFinite(win) && map.mergeWindowMin !== '' && map.mergeWindowMin !== undefined ? win : DEFAULT_SETTINGS.mergeWindowMin,
      ...feedingFrom(map),
      parents: [map.parent1 || DEFAULT_SETTINGS.parents[0], map.parent2 || DEFAULT_SETTINGS.parents[1]],
      medicines: this.readMedicines(),
    };
  }
  private readMedicines(): Medicine[] {
    const sh = this.ss.getSheetByName(MEDICINES);
    if (!sh || sh.getLastRow() < 2) return [];
    const out: Medicine[] = [];
    for (const r of sh.getRange(2, 1, sh.getLastRow() - 1, MED_HEADER.length).getValues()) {
      const n = (v: unknown) => (v === '' || v === null ? 0 : Number(v));
      const u = r[14] as { getTime?: () => number } | string | null;
      const until = u && typeof u === 'object' && typeof u.getTime === 'function' ? formatLocal(u.getTime()).slice(0, 10) : String(u ?? '').replace(/^'/, '');
      const raw = { id: String(r[0]), name: String(r[1]), dose: String(r[2]), schedule: String(r[3]), timesPerDay: n(r[4]), everyHours: n(r[5]), minGapHours: n(r[6]), maxPerDay: n(r[7]), course: String(r[8] || 'none'), courseCount: n(r[9]), status: String(r[10] || 'active'), icon: String(r[12] ?? ''), doseUnit: String(r[13] ?? ''), courseUntil: until };
      const m = normalizeMedicine(raw);
      if (m.ok) out.push({ ...m.medicine, created: toLocal(r[11]) }); // a row broken by hand is skipped rather than breaking the app
    }
    return out;
  }
  private writeMedicines(list: readonly Medicine[]): void {
    const existing = this.ss.getSheetByName(MEDICINES);
    const sh = existing ?? this.ss.insertSheet(MEDICINES);
    if (!existing) writeReadme(this.ss); // a sheet set up before medicines existed gets the guide that explains them
    const blank = (v: number) => (v === 0 ? '' : v);
    // course_until is written as text ("'" keeps the sheet from turning it into a date)
    const rows = list.map((m) => [m.id, m.name, m.dose, m.schedule, blank(m.timesPerDay), blank(m.everyHours), blank(m.minGapHours), blank(m.maxPerDay), m.course, blank(m.courseCount), m.status, toCell(m.created), m.icon, m.doseUnit, m.courseUntil ? `'${m.courseUntil}` : '']);
    sh.clear();
    sh.getRange(1, 1, 1, MED_HEADER.length).setValues([MED_HEADER]);
    if (rows.length) sh.getRange(2, 1, rows.length, MED_HEADER.length).setValues(rows);
  }
  setSettings(s: Settings): void {
    timed('write', () => {
      this.writeSettings(s);
      SpreadsheetApp.flush();
    });
    // a new settings version: every stored copy is void from now on (the next read takes the sheet and stores a fresh one)
    const ver = String(Number(P().SETTINGS_REV ?? '0') + 1);
    timed('props', () => props().setProperty('SETTINGS_REV', ver));
    P().SETTINGS_REV = ver;
  }
  private writeSettings(s: Settings): void {
    const sh = this.ss.getSheetByName(SETTINGS) ?? this.ss.insertSheet(SETTINGS);
    const rows = [
      ['babyName', s.babyName],
      ['mergeWindowMin', s.mergeWindowMin],
      ['parent1', s.parents[0]],
      ['parent2', s.parents[1]],
      ['babySex', s.babySex ?? ''],
      // written as text ("'" keeps the sheet from turning it into a date)
      ['babyBirth', s.babyBirth ? `'${s.babyBirth}` : ''],
      // (F18) the kinds of feeding and the default amount per bottle kind; empty until the parents change them
      ['feedBreast', s.feeding ? s.feeding.breast : ''],
      ['feedExpressed', s.feeding ? s.feeding.expressed : ''],
      ['feedFormula', s.feeding ? s.feeding.formula : ''],
      ['mlExpressed', s.feeding ? s.feeding.expressedMl : ''],
      ['mlFormula', s.feeding ? s.feeding.formulaMl : ''],
    ];
    sh.getRange(1, 1, rows.length, 2).setValues(rows);
    this.writeMedicines(s.medicines);
  }
  sheetUrl(): string {
    if (FAMILY) return ''; // the sheet lives in the owner's Drive: a family's phone gets no link (core also drops it)
    return this.ss.getUrl();
  }
  revision(): string {
    return P().REV ?? '0';
  }
  /** The revision and the journal of recent changes move together, in one call (both read under the lock: it drops the snapshot). */
  bump(change?: Change): void {
    const prev = P().REV ?? '0';
    const next = String(Number(prev) + 1);
    const journal = JSON.stringify(record(parseJournal(P().JOURNAL), prev, next, change));
    timed('props', () => props().setProperties({ REV: next, JOURNAL: journal }));
    P().REV = next;
    P().JOURNAL = journal;
  }
  private feedbackSheet(create: boolean): GoogleAppsScript.Spreadsheet.Sheet | null {
    const sh = this.ss.getSheetByName(FEEDBACK);
    if (sh || !create) return sh;
    const made = this.ss.insertSheet(FEEDBACK);
    made.getRange(1, 1, 1, FB_HEADER.length).setValues([FB_HEADER]).setFontWeight('bold');
    made.setFrozenRows(1);
    made.getRange(2, 2, made.getMaxRows() - 1, 1).setNumberFormat(DATE_FORMAT);
    return made;
  }
  feedbackAll(): FeedbackItem[] {
    const sh = this.feedbackSheet(false);
    const last = sh ? sh.getLastRow() : 0;
    if (!sh || last < 2) return [];
    const kinds = Object.entries(FB_KIND);
    return timed('read', () => sh.getRange(2, 1, last - 1, FB_HEADER.length).getValues())
      .filter((r) => r[0] !== '' && r[7] !== '')
      .map((r) => ({
        no: Number(r[0]),
        created: toLocal(r[1]),
        user: String(r[2] ?? ''),
        kind: (kinds.find(([, label]) => label === r[3])?.[0] ?? 'other') as FeedbackKind,
        text: fromText(r[4]),
        version: String(r[5] ?? ''),
        log: fromText(r[6]),
        id: String(r[7] ?? ''),
      }));
  }
  feedbackAdd(item: Omit<FeedbackItem, 'no'>): FeedbackItem {
    const no = Number(P().FEEDBACK_SEQ ?? '0') + 1; // read under the lock (the lock drops the snapshot)
    const sh = this.feedbackSheet(true)!;
    timed('write', () => {
      sh.appendRow([no, toCell(item.created), item.user, FB_KIND[item.kind], asText(item.text), item.version, asText(item.log), item.id]);
      SpreadsheetApp.flush();
    });
    timed('props', () => props().setProperty('FEEDBACK_SEQ', String(no)));
    P().FEEDBACK_SEQ = String(no);
    return { ...item, no };
  }
  /** (owner, family servers) Request counts per day over every phone (numbers only), read from the usage tab. */
  usageTotals(dates: readonly string[]): UsageTotal[] {
    const out = dates.map((date) => ({ date, requests: 0, ops: 0, phones: 0 }));
    const sh = this.ss.getSheetByName(USAGE);
    const last = sh ? sh.getLastRow() : 0;
    if (!sh || last < 2) return out;
    const width = sh.getLastColumn();
    const values = timed('read', () => sh.getRange(1, 1, last, width).getValues());
    const header = values[0]!.map((h) => String(h ?? ''));
    const col = (k: string) => header.indexOf(USAGE_LABELS[k]!);
    const [req, ops] = [col('sync.requests'), col('sync.ops')];
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
    const phones = new Map<string, Set<string>>();
    for (const r of values.slice(1)) {
      const date = String(r[0] ?? '').replace(/^'/, '');
      const day = out.find((d) => d.date === date);
      if (!day) continue;
      if (req >= 0) day.requests += num(r[req]);
      if (ops >= 0) day.ops += num(r[ops]);
      (phones.get(date) ?? phones.set(date, new Set()).get(date)!).add(String(r[2] ?? ''));
    }
    for (const d of out) d.phones = phones.get(d.date)?.size ?? 0;
    return out;
  }
  /** No lock: each phone writes only its own rows (date, parent, phone), and a beacon is never waited for. */
  usageSave(user: string, install: string, version: string, days: readonly UsageDay[], now: string): void {
    timed('write', () => {
      let sh = this.ss.getSheetByName(USAGE);
      // a tab has 26 columns at first; a range beyond them is refused, so make room before writing wider rows
      const room = (s: GoogleAppsScript.Spreadsheet.Sheet, n: number) => {
        const max = s.getMaxColumns();
        if (n > max) s.insertColumnsAfter(max, n - max);
      };
      if (!sh) {
        sh = this.ss.insertSheet(USAGE);
        const all = [...USAGE_FIXED, ...Object.values(USAGE_LABELS), ...Object.keys(USAGE_QUESTIONS).map(questionColumn)];
        room(sh, all.length);
        sh.getRange(1, 1, 1, all.length).setValues([all]).setFontWeight('bold');
        sh.setFrozenRows(1);
      }
      const header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), USAGE_FIXED.length)).getValues()[0]!.map((h) => String(h ?? ''));
      const width = header.length;
      for (const d of days) for (const k of Object.keys(d.counts)) if (!header.includes(USAGE_LABELS[k]!)) header.push(USAGE_LABELS[k]!);
      for (const d of days) for (const k of Object.keys(d.states ?? {})) if (!header.includes(questionColumn(k))) header.push(questionColumn(k));
      if (header.length > width) {
        room(sh, header.length);
        sh.getRange(1, 1, 1, header.length).setValues([header]);
      }
      const last = sh.getLastRow();
      const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 3).getValues().map((r) => r.map((v) => String(v ?? '').replace(/^'/, ''))) : [];
      const byLabel = new Map(Object.entries(USAGE_LABELS).map(([k, label]) => [label, k]));
      const byQuestion = new Map(Object.keys(USAGE_QUESTIONS).map((k) => [questionColumn(k), k]));
      for (const d of days) {
        const row = header.map((h, i) => {
          if (i < USAGE_FIXED.length) return [`'${d.date}`, user, install, version, toCell(now)][i]!;
          const q = byQuestion.get(h);
          if (q !== undefined) return d.states?.[q] ? QUESTION_STATES[d.states[q]] : '';
          const k = byLabel.get(h);
          return k !== undefined && d.counts[k] ? d.counts[k]! : '';
        });
        const i = keys.findIndex((r) => r[0] === d.date && r[1] === user && r[2] === install);
        const at = i >= 0 ? i + 2 : keys.push([d.date, user, install]) + 1;
        sh.getRange(at, 1, 1, row.length).setValues([row]);
      }
      SpreadsheetApp.flush();
    });
  }
  /** Empties the tab below its titles (the numbering in FEEDBACK_SEQ goes on). Rows are cleared, not deleted: a sheet refuses to lose all its unfrozen rows. */
  feedbackClear(ids?: readonly string[]): void {
    const sh = this.feedbackSheet(false);
    const last = sh ? sh.getLastRow() : 0;
    if (!sh || last < 2) return;
    timed('write', () => {
      if (!ids) sh.getRange(2, 1, last - 1, FB_HEADER.length).clearContent();
      else {
        // only the items the owner has seen: one sent meanwhile stays (an emptied row is skipped by feedbackAll)
        const col = sh.getRange(2, 8, last - 1, 1).getValues();
        col.forEach((r, i) => {
          if (ids.includes(String(r[0] ?? ''))) sh.getRange(i + 2, 1, 1, FB_HEADER.length).clearContent();
        });
      }
      SpreadsheetApp.flush();
    });
  }
  /** Answered from the properties every request reads anyway: no sheet. A journal that does not end at REV is not used. */
  changesSince(rev: string): Since | null {
    return since(parseJournal(P().JOURNAL), rev, this.revision());
  }
}

function fatal(msg: string): never {
  throw new Error(msg);
}

const props = () => PropertiesService.getScriptProperties();
/**
 * A property value may hold about 9 KB, and Hebrew letters take two bytes each: settings longer than this many characters
 * (some twenty medicines) are simply not kept as a copy and are read from the sheet as before.
 */
const SETTINGS_CACHE_MAX = 4000;
/**
 * All script properties, read with ONE call per request (each call costs 20 to 400 ms). Taking the lock drops the snapshot,
 * so everything decided under the lock (the revision, the settings version) is read fresh.
 */
let snapshot: Record<string, string> | null = null;
function P(): Record<string, string> {
  return (snapshot ??= timed('props', () => props().getProperties()));
}

function deps(): Deps {
  const checkKey = makeCheckKey(P().API_KEY ?? null, __FIXED_KEY__);
  const store = new SheetStore();
  return {
    store,
    now: () => Date.now(),
    checkKey,
    ...(FAMILY ? { familyServer: true, checkAdmin: makeCheckKey(P().ADMIN_KEY ?? null, '') } : {}),
    withLock: (fn) => {
      const lock = LockService.getScriptLock();
      timed('lock', () => lock.waitLock(10_000));
      snapshot = null; // someone may have written while we waited
      store.locked();
      try {
        return fn();
      } finally {
        timed('unlock', () => lock.releaseLock());
      }
    },
  };
}

function json(o: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  let body: unknown = null;
  try {
    body = JSON.parse(e.postData.contents);
  } catch {
    body = null;
  }
  const t0 = Date.now();
  spent = {};
  snapshot = null;
  const answer = handle(body, deps());
  const debug = typeof body === 'object' && body !== null && (body as { debug?: unknown }).debug === true;
  // `ms`: our own time, so a phone can tell it from the time the trip itself takes
  return json({ ...answer, ms: Date.now() - t0, build: __BUILD__, ...(debug ? { t: spent } : {}) });
}

export function doGet(): GoogleAppsScript.Content.TextOutput {
  return json({ ok: true, app: 'babylog', version: API_VERSION });
}

const b64url = (s: string) =>
  Utilities.base64EncodeWebSafe(Utilities.newBlob(s).getBytes()).replace(/=+$/, '');

function newKey(): string {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

export function printInstallCode(): void {
  const key = props().getProperty('API_KEY');
  if (!key) {
    console.log('No key yet. Run setup() first.');
    return;
  }
  let url = __EXEC_URL__;
  if (!url) {
    try {
      url = ScriptApp.getService().getUrl() ?? '';
    } catch (err) {
      console.log(`Could not read the web app URL automatically (${String(err)}).`);
    }
  }
  if (!url) {
    console.log('The web app URL is not available here. Copy it from Deploy > Manage deployments (the one ending in /exec), then build the code as BL1. + base64url({"u":"<url>","k":"<key>"}).');
    console.log(`KEY: ${key}`);
    return;
  }
  if (!/\/exec$/.test(url)) {
    console.log('WARNING: this address (ending in /dev) only works for you inside this browser, not from phones or Siri.');
    console.log('Fix: Deploy > Manage deployments > copy the Web app URL (ends in /exec) and paste it in the app next to this code.');
  }
  console.log('Paste this setup code into the app (Settings screen on first launch):');
  console.log(encodeInstallCode(url, key, b64url));
  const admin = props().getProperty('ADMIN_KEY');
  if (FAMILY && admin) {
    console.log('');
    console.log('FOR THE OWNER ONLY (do not send it to the family): the admin code, for reading this family\'s feedback.');
    console.log('In the app: Settings > מתקדם > משוב > משפחות נוספות > הוספה. It opens the feedback only, never the log.');
    console.log(encodeAdminCode(url, admin, b64url));
  }
}

function writeReadme(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): void {
  const readme = ss.getSheetByName(README) ?? ss.insertSheet(README);
  readme.clear();
  README_ROWS.forEach((r, i) => readme.getRange(i + 1, 1, 1, r.length).setValues([r]));
  readme.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  readme.setColumnWidth(1, 120);
  readme.setColumnWidth(2, 700);
}

/** One-time setup: creates the sheets, the secret key, and prints the setup code. */
export function setup(): void {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ_NAME);
  const events = ss.getSheetByName(EVENTS) ?? ss.insertSheet(EVENTS);
  if (events.getLastRow() === 0) {
    events.getRange(1, 1, 1, COLS).setValues([HEADER]).setFontWeight('bold');
    events.setFrozenRows(1);
    for (const c of [4, 5, 9, 10]) events.getRange(2, c, events.getMaxRows() - 1, 1).setNumberFormat(DATE_FORMAT);
    events.setColumnWidths(1, 1, 120);
    events.setColumnWidths(4, 2, 140);
    events.setColumnWidths(9, 2, 140);
  }
  const first = ss.getSheets()[0];
  if (first && first.getName() !== EVENTS && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  const store = new SheetStore();
  snapshot = null;
  store.setSettings(store.readSettings()); // from the sheet itself: this is how a hand edit of the settings tabs is taken in
  writeReadme(ss);
  if (!props().getProperty('API_KEY')) props().setProperty('API_KEY', newKey());
  if (FAMILY && !props().getProperty('ADMIN_KEY')) props().setProperty('ADMIN_KEY', newKey());
  printInstallCode();
}

/** Replaces the secret key (invalidates every installed copy of the app and shortcuts). */
export function rotateKey(): void {
  props().setProperty('API_KEY', newKey());
  printInstallCode();
}

// The build (scripts/build-server.ts) wraps this module and re-declares the entry points as plain
// top-level functions. The Apps Script editor only lists (and can run) functions declared that way.
