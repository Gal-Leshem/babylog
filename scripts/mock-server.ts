import { createServer } from 'node:http';
import { type Deps, handle } from '../src/server/core';
import { MemoryStore } from '../src/server/memory-store';

/** Local stand-in for the Apps Script server: same core, memory storage. Used by e2e tests and dev. */
export function startMockServer(port = 8787, key = 'test-key') {
  let store = new MemoryStore();
  const deps: Deps = {
    get store() {
      return store;
    },
    now: () => Date.now(),
    checkKey: (k) => k === key,
    withLock: (fn) => fn(),
  };
  const calls: unknown[] = [];
  /** What each request was, for tests: the action; a `sync` also says how many operations it carried and whether the list came back. */
  const kinds: string[] = [];
  const baseDelay = Number(process.env.MOCK_DELAY ?? 0);
  let delayMs = baseDelay;
  let offline = false;
  /** Behave like a server from before `sync` (API 0.3.0). */
  let old = false;
  // A write that is still on its way (MOCK_DELAY) when a test resets the server must not land in the next test's fresh store.
  let generation = 0;
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (req.url?.startsWith('/__control')) {
      const q = new URL(req.url, 'http://x').searchParams;
      if (q.has('offline')) offline = q.get('offline') === '1';
      if (q.has('delay')) delayMs = Number(q.get('delay'));
      if (q.has('old')) old = q.get('old') === '1';
      if (q.has('forget')) kinds.length = 0;
      if (q.has('reset')) {
        // a real server's revision never starts over: keep it climbing, or a phone could hold the "same" number from before
        store = new MemoryStore([], undefined, Number(store.revision()) + 1000);
        generation++;
        calls.length = 0;
        kinds.length = 0;
        offline = false;
        old = false;
        delayMs = baseDelay;
      }
      return void res.writeHead(200).end('ok');
    }
    if (req.url?.startsWith('/__calls')) {
      return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(kinds));
    }
    if (req.method === 'POST' && req.url?.startsWith('/__seed')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        for (const e of JSON.parse(raw) as import('../src/shared/types').BabyEvent[]) store.append(e);
        store.bump(); // like every real write
        res.writeHead(200).end('ok');
      });
      return;
    }
    if (req.method === 'GET') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true,"app":"babylog"}');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (offline) return void req.socket.destroy();
      const gen = generation;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* handled below */
      }
      setTimeout(() => {
        if (gen !== generation) return void req.socket.destroy(); // sent before a reset: belongs to the previous test
        calls.push(parsed);
        const t0 = Date.now();
        const answer = old && (parsed as { action?: string } | null)?.action === 'sync' ? { ok: false, error: 'unknown_action', detail: 'sync' } : handle(parsed, deps);
        const p = parsed as { action?: string; ops?: unknown[] } | null;
        const a = answer as { unchanged?: boolean; events?: unknown; changes?: unknown };
        kinds.push(p?.action === 'sync' ? `sync${p.ops?.length ? `:${p.ops.length}` : ''}${a.events ? '+list' : ''}${a.changes ? '+changes' : ''}` : (p?.action ?? '?'));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...answer, ms: Date.now() - t0 }));
      }, delayMs);
    });
  });
  return {
    get store() {
      return store;
    },
    calls,
    listen: () => new Promise<void>((r) => server.listen(port, '127.0.0.1', r)),
    /** The port actually in use (useful when started with port 0). */
    port: () => (server.address() as { port: number }).port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // MOCK_SERVERS=n starts n independent servers on consecutive ports (one per Playwright worker)
  const first = Number(process.env.PORT ?? 8787);
  const count = Math.max(1, Number(process.env.MOCK_SERVERS ?? 1));
  for (let i = 0; i < count; i++) await startMockServer(first + i).listen();
  console.log(`mock server${count > 1 ? 's' : ''} on ${first}${count > 1 ? `-${first + count - 1}` : ''}, key "test-key"`);
}
