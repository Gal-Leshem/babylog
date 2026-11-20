import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

type Cell = string | number | boolean | Date;

/** Minimal in-memory imitation of the parts of Google Sheets / Apps Script the server uses. */
export function createGasRuntime(opts: { url?: string | null } = {}) {
  const sheets = new Map<string, Cell[][]>();
  const props = new Map<string, string>();
  const logs: string[] = [];
  let locks = 0;
  /** How many calls reached each Google service (the slow part of every request). */
  const calls = { props: 0, values: 0, find: 0 };

  const sheetObj = (name: string) => {
    const rows = () => sheets.get(name)!;
    const lastRow = () => {
      const r = rows();
      for (let i = r.length - 1; i >= 0; i--) if (r[i]!.some((c) => c !== '' && c !== undefined)) return i + 1;
      return 0;
    };
    const rangeObj = (r0: number, c0: number, nr: number, nc: number): any => {
      const self: any = {
        getValues: () => (calls.values++, 0) || Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows()[r0 - 1 + i]?.[c0 - 1 + j] ?? '')),
        setValues: (v: Cell[][]) => {
          v.forEach((row, i) =>
            row.forEach((val, j) => {
              const R = (rows()[r0 - 1 + i] ??= []);
              R[c0 - 1 + j] = val;
            }),
          );
          return self;
        },
        getRow: () => r0,
        setValue: (v: Cell) => self.setValues([[v]]),
        getValue: () => rows()[r0 - 1]?.[c0 - 1] ?? '',
        setFontWeight: () => self,
        setFontSize: () => self,
        setNumberFormat: () => self,
        clearContent: () => {
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (rows()[r0 - 1 + i]) rows()[r0 - 1 + i]![c0 - 1 + j] = '';
          return self;
        },
        createTextFinder: (text: string) => {
          let entire = false;
          const f: any = {
            matchEntireCell: (b: boolean) => ((entire = b), f),
            matchCase: () => f,
            findNext: () => {
              calls.find++;
              for (let i = 0; i < nr; i++) {
                const v = rows()[r0 - 1 + i]?.[c0 - 1];
                if (v !== undefined && (entire ? String(v) === text : String(v).includes(text))) return rangeObj(r0 + i, c0, 1, 1);
              }
              return null;
            },
          };
          return f;
        },
      };
      return self;
    };
    return {
      getName: () => name,
      getLastRow: lastRow,
      getLastColumn: () => Math.max(0, ...rows().map((r) => r.length)),
      getMaxRows: () => 1000,
      getRange: (a: number | string, b?: number, c?: number, d?: number) => {
        if (typeof a === 'string') {
          const m = /^([A-Z])(\d+):[A-Z]$/.exec(a)!;
          const col = m[1]!.charCodeAt(0) - 64;
          return rangeObj(+m[2]!, col, Math.max(1000 - +m[2]! + 1, 1), 1);
        }
        return rangeObj(a, b!, c ?? 1, d ?? 1);
      },
      appendRow: (row: Cell[]) => rows().splice(lastRow(), 0, row),
      setFrozenRows: () => undefined,
      setColumnWidths: () => undefined,
      setColumnWidth: () => undefined,
      clear: () => rows().splice(0, rows().length),
    };
  };

  const ensure = (name: string) => {
    if (!sheets.has(name)) sheets.set(name, []);
    return sheetObj(name);
  };
  ensure('Sheet1'); // a fresh bound spreadsheet starts with one default sheet

  const ss = {
    setSpreadsheetTimeZone: () => undefined,
    getSheetByName: (n: string) => (sheets.has(n) ? sheetObj(n) : null),
    insertSheet: (n: string) => ensure(n),
    getSheets: () => [...sheets.keys()].map(sheetObj),
    deleteSheet: (s: { getName(): string }) => sheets.delete(s.getName()),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/FAKE/edit',
  };

  const out = (s: string) => {
    const o: any = { getContent: () => s, setMimeType: () => o };
    return o;
  };

  const context: any = {
    console: { log: (...a: unknown[]) => logs.push(a.join(' ')) },
    SpreadsheetApp: { getActive: () => ss, flush: () => undefined },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (calls.props++, props.get(k) ?? null),
        getProperties: () => (calls.props++, Object.fromEntries(props)),
        setProperty: (k: string, v: string) => {
          calls.props++;
          if (v.length > 9000) throw new Error('Argument too large: value'); // the real limit is about 9 KB per value
          props.set(k, v);
        },
        setProperties: (o: Record<string, string>) => {
          calls.props++;
          // the real limit is about 9 KB per value, in bytes (Hebrew letters take two)
          for (const v of Object.values(o)) if (Buffer.byteLength(v, 'utf8') > 9000) throw new Error('Argument too large: value');
          for (const [k, v] of Object.entries(o)) props.set(k, v);
        },
        deleteProperty: (k: string) => (calls.props++, void props.delete(k)),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => void locks++, releaseLock: () => void locks-- }) },
    ContentService: { createTextOutput: out, MimeType: { JSON: 'json' } },
    Utilities: {
      getUuid: () => randomUUID(),
      newBlob: (s: string) => ({ getBytes: () => Buffer.from(s, 'utf8') }),
      base64EncodeWebSafe: (b: Buffer) => b.toString('base64url') + '==',
    },
    ScriptApp: { getService: () => ({ getUrl: () => (opts.url === undefined ? 'https://script.google.com/macros/s/FAKE/exec' : opts.url) }) },
  };
  context.globalThis = context;
  vm.createContext(context);

  return {
    load(code: string) {
      vm.runInContext(code, context);
      return context as Record<string, (...a: any[]) => any>;
    },
    sheets,
    props,
    logs,
    openLocks: () => locks,
    calls,
    context,
  };
}
