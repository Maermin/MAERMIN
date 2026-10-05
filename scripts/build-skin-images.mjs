// Builds data/skin-images.json: CS2 item name -> Steam CDN image hash, for the
// skin picker (MaerminSkinPrices.imageFor). Source: ByMykel's CSGO-API
// (https://github.com/ByMykel/CSGO-API, MIT). Skins are listed once per skin
// (all wears and StatTrak™/Souvenir variants share the picture). Stickers are
// left out (they would triple the file).
// Run when new cases/skins appear: node scripts/build-skin-images.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/';
const FILES = ['skins.json', 'crates.json', 'agents.json', 'keys.json', 'music_kits.json', 'patches.json', 'graffiti.json', 'keychains.json', 'collectibles.json'];
const PREFIX = 'https://community.akamai.steamstatic.com/economy/image/';

const out = {};
for (const f of FILES) {
  const res = await fetch(SRC + f);
  if (!res.ok) throw new Error(f + ': HTTP ' + res.status);
  const data = await res.json();
  let n = 0;
  for (const it of Array.isArray(data) ? data : Object.values(data)) {
    const name = it && (it.market_hash_name || it.name);
    const img = it && it.image;
    if (!name || typeof img !== 'string' || !img.startsWith(PREFIX)) continue;
    out[name] = img.slice(PREFIX.length);
    n++;
  }
  console.log(f.padEnd(18), n);
}
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'skin-images.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(sorted) + '\n');
console.log('wrote', Object.keys(sorted).length, 'items to', target);
