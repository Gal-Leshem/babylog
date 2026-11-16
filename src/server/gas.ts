/// <reference types="google-apps-script" />
import { type Medicine, normalizeMedicine } from '../shared/medicines';
import { API_VERSION } from '../shared/protocol';
import { TZ_NAME, formatLocal, parseLocal } from '../shared/tz';
import { type BabyEvent, DEFAULT_SETTINGS, type EventType, type Settings, type Source } from '../shared/types';
import { encodeInstallCode, makeCheckKey } from './auth';
import { type Deps, type Store, handle } from './core';
import { README_ROWS } from './readme';

/** Replaced at build time. Non-empty only in the TEST build. */
declare const __FIXED_KEY__: string;
/**
 * The deployed web app address (ends in /exec), embedded by the deploy pipeline. Needed because
 * ScriptApp.getService().getUrl() returns the editor's private /dev address when run from the editor.
 */
declare const __EXEC_URL__: string;

const EVENTS = 'Events';
const SETTINGS = 'Settings';
const README = 'קרא אותי';
const MEDICINES = 'Medicines';
/** One row per medicine besides vitamin D; numbers that do not apply to the schedule are left empty. */
const MED_HEADER = ['id', 'name', 'dose', 'schedule', 'times_per_day', 'every_hours', 'min_gap_hours', 'max_per_day', 'course', 'course_count', 'status', 'created'];
const HEADER = ['id', 'type', 'detail', 'start', 'end', 'user', 'source', 'note', 'created', 'edited', 'deleted'];
const COLS = HEADER.length;
const DATE_FORMAT = 'yyyy-mm-dd hh:mm';

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
  };
}
function eventToRow(e: BabyEvent): unknown[] {
  return [e.id, e.type, e.detail, toCell(e.start), toCell(e.end), e.user, e.source, e.note, toCell(e.created), toCell(e.edited), e.deleted];
}

class SheetStore implements Store {
  private ss = SpreadsheetApp.getActive();

  private events(): GoogleAppsScript.Spreadsheet.Sheet {
    return this.ss.getSheetByName(EVENTS) ?? fatal('Events sheet missing: run setup()');
  }
  private read(fromRow: number): BabyEvent[] {
    const sh = this.events();
    const last = sh.getLastRow();
    if (last < 2) return [];
    const start = Math.max(2, fromRow);
    return sh
      .getRange(start, 1, last - start + 1, COLS)
      .getValues()
      .filter((r) => r[0] !== '')
      .map(rowToEvent);
  }
  recent(n: number): BabyEvent[] {
    return this.read(this.events().getLastRow() - n + 1);
  }
  all(): BabyEvent[] {
    return this.read(2);
  }
  private rowOf(id: string): number {
    const hit = this.events().getRange('A2:A').createTextFinder(id).matchEntireCell(true).matchCase(true).findNext();
    return hit ? hit.getRow() : 0;
  }
  find(id: string): BabyEvent | undefined {
    const row = this.rowOf(id);
    if (!row) return undefined;
    return rowToEvent(this.events().getRange(row, 1, 1, COLS).getValues()[0]!);
  }
  append(e: BabyEvent): void {
    this.events().appendRow(eventToRow(e));
    SpreadsheetApp.flush();
  }
  replace(e: BabyEvent): boolean {
    const row = this.rowOf(e.id);
    if (!row) return false;
    this.events().getRange(row, 1, 1, COLS).setValues([eventToRow(e)]);
    SpreadsheetApp.flush();
    return true;
  }
  getSettings(): Settings {
    const sh = this.ss.getSheetByName(SETTINGS);
    const map: Record<string, string> = {};
    if (sh && sh.getLastRow() >= 1) {
      for (const [k, v] of sh.getRange(1, 1, sh.getLastRow(), 2).getValues()) map[String(k)] = String(v);
    }
    const win = Number(map.mergeWindowMin);
    return {
      babyName: map.babyName || DEFAULT_SETTINGS.babyName,
      mergeWindowMin: Number.isFinite(win) && map.mergeWindowMin !== '' && map.mergeWindowMin !== undefined ? win : DEFAULT_SETTINGS.mergeWindowMin,
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
      const raw = { id: String(r[0]), name: String(r[1]), dose: String(r[2]), schedule: String(r[3]), timesPerDay: n(r[4]), everyHours: n(r[5]), minGapHours: n(r[6]), maxPerDay: n(r[7]), course: String(r[8] || 'none'), courseCount: n(r[9]), status: String(r[10] || 'active') };
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
    const rows = list.map((m) => [m.id, m.name, m.dose, m.schedule, blank(m.timesPerDay), blank(m.everyHours), blank(m.minGapHours), blank(m.maxPerDay), m.course, blank(m.courseCount), m.status, toCell(m.created)]);
    sh.clear();
    sh.getRange(1, 1, 1, MED_HEADER.length).setValues([MED_HEADER]);
    if (rows.length) sh.getRange(2, 1, rows.length, MED_HEADER.length).setValues(rows);
  }
  setSettings(s: Settings): void {
    const sh = this.ss.getSheetByName(SETTINGS) ?? this.ss.insertSheet(SETTINGS);
    const rows = [
      ['babyName', s.babyName],
      ['mergeWindowMin', s.mergeWindowMin],
      ['parent1', s.parents[0]],
      ['parent2', s.parents[1]],
    ];
    sh.getRange(1, 1, rows.length, 2).setValues(rows);
    this.writeMedicines(s.medicines);
  }
  sheetUrl(): string {
    return this.ss.getUrl();
  }
  revision(): string {
    return props().getProperty('REV') ?? '0';
  }
  bump(): void {
    props().setProperty('REV', String(Number(props().getProperty('REV') ?? '0') + 1));
  }
}

function fatal(msg: string): never {
  throw new Error(msg);
}

const props = () => PropertiesService.getScriptProperties();

function deps(): Deps {
  const checkKey = makeCheckKey(props().getProperty('API_KEY'), __FIXED_KEY__);
  return {
    store: new SheetStore(),
    now: () => Date.now(),
    checkKey,
    withLock: (fn) => {
      const lock = LockService.getScriptLock();
      lock.waitLock(10_000);
      try {
        return fn();
      } finally {
        lock.releaseLock();
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
  return json(handle(body, deps()));
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
  store.setSettings(store.getSettings());
  writeReadme(ss);
  if (!props().getProperty('API_KEY')) props().setProperty('API_KEY', newKey());
  printInstallCode();
}

/** Replaces the secret key (invalidates every installed copy of the app and shortcuts). */
export function rotateKey(): void {
  props().setProperty('API_KEY', newKey());
  printInstallCode();
}

// The build (scripts/build-server.ts) wraps this module and re-declares the entry points as plain
// top-level functions. The Apps Script editor only lists (and can run) functions declared that way.
