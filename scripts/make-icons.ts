import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

/** Renders the app icon (a crescent moon and a star on dark blue) to PNG files in public/. */
const svg = (inset: number) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#0b1630"/>
  <g transform="translate(256 256) scale(${1 - inset}) translate(-256 -256)">
    <path d="M300 96a160 160 0 1 0 116 270A130 130 0 0 1 300 96z" fill="#f3d9a4"/>
    <circle cx="372" cy="150" r="14" fill="#f3d9a4"/>
    <circle cx="420" cy="214" r="8" fill="#f3d9a4"/>
  </g>
</svg>`;

const jobs: [string, number, number][] = [
  ['public/icon-512.png', 512, 0],
  ['public/icon-192.png', 192, 0],
  ['public/apple-touch-icon.png', 180, 0],
  ['public/icon-maskable-512.png', 512, 0.22],
];

const browser = await chromium.launch();
for (const [file, size, inset] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg(inset)}`);
  writeFileSync(file, await page.screenshot({ type: 'png' }));
  await page.close();
}
await browser.close();
console.log('icons written');
