/**
 * Copies ffmpeg-core ESM files from node_modules into public/ffmpeg/
 * Runs automatically after `npm install` (postinstall hook).
 * Manual run: node setup-ffmpeg.js
 */
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dest = join(__dirname, 'public', 'ffmpeg');
mkdirSync(dest, { recursive: true });

// Search for @ffmpeg/core in likely locations (monorepo / standalone)
const candidates = [
  join(__dirname, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm'),
  join(__dirname, '..', '..', 'node_modules', '@ffmpeg', 'core', 'dist', 'esm'),
  join(__dirname, '..', '..', 'node_modules', '.pnpm'),
];

let esmDir = null;
for (const c of candidates.slice(0, 2)) {
  if (existsSync(join(c, 'ffmpeg-core.wasm'))) { esmDir = c; break; }
}

// pnpm virtual store fallback
if (!esmDir) {
  const pnpmStore = join(__dirname, '..', '..', 'node_modules', '.pnpm');
  if (existsSync(pnpmStore)) {
    const { readdirSync } = await import('fs');
    const entries = readdirSync(pnpmStore);
    const coreEntry = entries.find(e => e.startsWith('@ffmpeg+core@'));
    if (coreEntry) {
      esmDir = join(pnpmStore, coreEntry, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
    }
  }
}

if (!esmDir) {
  console.error('❌ Could not locate @ffmpeg/core in node_modules. Run: pnpm install');
  process.exit(1);
}

const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];
let copied = 0;
for (const f of files) {
  const src = join(esmDir, f);
  const out = join(dest, f);
  if (existsSync(src)) {
    copyFileSync(src, out);
    console.log(`✓ Copied ${f}`);
    copied++;
  } else {
    console.warn(`⚠ Not found: ${src}`);
  }
}

console.log(`\nFFmpeg setup complete (${copied}/${files.length} files copied).`);
