import { createServer } from 'node:http';
import { type Deps, handle } from '../src/server/core';
import { MemoryStore } from '../src/server/memory-store';

/** Local stand-in for the Apps Script server: same core, memory storage. Used by e2e tests and dev. */
export function startMockServer(port = 8787, key = 'test-key') {
  const store = new MemoryStore();
  const deps: Deps = { store, now: () => Date.now(), checkKey: (k) => k === key, withLock: (fn) => fn() };
  const calls: unknown[] = [];
  let delayMs = 0;
  let offline = false;
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (req.url?.startsWith('/__control')) {
      const q = new URL(req.url, 'http://x').searchParams;
      if (q.has('offline')) offline = q.get('offline') === '1';
      if (q.has('delay')) delayMs = Number(q.get('delay'));
      if (q.has('reset')) store.setSettings(new MemoryStore().getSettings());
      return void res.writeHead(200).end('ok');
    }
    if (req.method === 'GET') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true,"app":"babylog"}');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (offline) return void req.socket.destroy();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* handled below */
      }
      setTimeout(() => {
        calls.push(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(handle(parsed, deps)));
      }, delayMs);
    });
  });
  return {
    store,
    calls,
    listen: () => new Promise<void>((r) => server.listen(port, '127.0.0.1', r)),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = startMockServer(Number(process.env.PORT ?? 8787));
  await s.listen();
  console.log(`mock server on ${process.env.PORT ?? 8787}, key "test-key"`);
}
