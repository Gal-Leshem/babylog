// Plain JS on purpose: the CI report must work even when `npm ci` failed.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Removes anything that should not appear in a public log. */
export function sanitizeLine(line, forbidden = []) {
  let s = String(line).replace(ANSI, '');
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  s = s.replace(/AKfycb[\w-]+/g, '[deployment]');
  s = s.replace(/(\/macros\/s\/)[\w-]+/g, '$1[id]');
  s = s.replace(/(spreadsheets\/d\/)[\w-]+/g, '$1[id]');
  s = s.replace(/(\/(?:projects|d)\/)[\w-]{20,}/g, '$1[id]');
  s = s.replace(/(?<![\w-])[A-Za-z0-9_-]{32,}(?![\w-])/g, '[token]');
  for (const w of forbidden) {
    if (!w) continue;
    s = s.split(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).join('[redacted]');
  }
  return s;
}

export function sanitizeLog(text, forbidden = [], maxLines = 80) {
  const lines = String(text).split('\n').map((l) => sanitizeLine(l, forbidden));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-maxLines);
}
