// Waits until the live site serves the commit we just published. Plain JS: no install needed.
const repo = process.env.GITHUB_REPOSITORY ?? '';
const [owner, name] = repo.split('/');
const want = (process.env.GITHUB_SHA ?? '').slice(0, 7);
if (!owner || !name || !want) {
  console.error('GITHUB_REPOSITORY / GITHUB_SHA missing');
  process.exit(1);
}
const url = `https://${owner.toLowerCase()}.github.io/${name}/version.json`;
let last = 'no response';
for (let i = 1; i <= 36; i++) {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const body = await res.json();
      if (body.commit === want) {
        console.log(`site is live and serves ${want}`);
        process.exit(0);
      }
      last = `serves ${body.commit}, waiting for ${want}`;
    } else last = `HTTP ${res.status}`;
  } catch (e) {
    last = String(e);
  }
  console.log(`attempt ${i}: ${last}`);
  await new Promise((r) => setTimeout(r, 10_000));
}
console.error(`site did not serve ${want} in time (${last}). If this is the first deploy, GitHub Pages may need enabling: Settings > Pages > Source: Deploy from a branch > gh-pages.`);
process.exit(1);
