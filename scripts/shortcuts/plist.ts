/** Minimal XML property-list writer (enough for Shortcuts files). */
export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function write(v: PlistValue, indent: string): string {
  if (typeof v === 'string') return `${indent}<string>${esc(v)}</string>\n`;
  if (typeof v === 'boolean') return `${indent}<${v ? 'true' : 'false'}/>\n`;
  if (typeof v === 'number') return Number.isInteger(v) ? `${indent}<integer>${v}</integer>\n` : `${indent}<real>${v}</real>\n`;
  if (Array.isArray(v)) {
    if (v.length === 0) return `${indent}<array/>\n`;
    return `${indent}<array>\n${v.map((x) => write(x, `${indent}\t`)).join('')}${indent}</array>\n`;
  }
  const keys = Object.keys(v).sort();
  if (keys.length === 0) return `${indent}<dict/>\n`;
  return `${indent}<dict>\n${keys.map((k) => `${indent}\t<key>${esc(k)}</key>\n${write(v[k]!, `${indent}\t`)}`).join('')}${indent}</dict>\n`;
}

export function toPlist(root: { [key: string]: PlistValue }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${write(root, '')}</plist>\n`;
}
