// Static checks: node --check on every JS file, manifest sanity, and a secret scan.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  if (['node_modules', '.git', 'dist'].includes(f)) return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk('.');
let fail = 0;
for (const f of files.filter((x) => /\.(m?js)$/.test(x))) {
  try { execFileSync(process.execPath, ['--check', f]); console.log(`ok   node --check ${f}`); } catch (e) { fail++; console.log(`FAIL node --check ${f}\n${e.stderr}`); }
}
const m = JSON.parse(readFileSync('manifest.json', 'utf8'));
const need = [m.background.service_worker, m.options_page, m.action.default_popup, ...m.content_scripts.flatMap((c) => c.js)];
for (const p of need) { if (!existsSync(p)) { fail++; console.log(`FAIL manifest path missing: ${p}`); } }
if (m.manifest_version !== 3 || !/^\d+\.\d+\.\d+$/.test(m.version) || /spike/i.test(m.name)) { fail++; console.log('FAIL manifest fields'); }
else console.log(`ok   manifest.json (MV3, ${m.name} ${m.version}, ${need.length} paths exist)`);
const secret = /crsr_[0-9a-f]{16,}|api2\.cursor\.sh\/automations\/webhook\/[0-9a-f-]{20,}/i;
for (const f of files) {
  if (/\.(png|zip)$/.test(f)) continue;
  if (secret.test(readFileSync(f, 'utf8'))) { fail++; console.log(`FAIL possible secret in ${f}`); }
}
console.log(fail ? `${fail} check(s) failed` : 'ok   secret scan clean');
process.exit(fail ? 1 : 0);
