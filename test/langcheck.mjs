// Checks every translation against English: no missing or stray keys, and the same {placeholders}.
//   npm run check:lang
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'lang');
const load = async (f) => (await import(pathToFileURL(join(dir, f)).href)).default;
const en = await load('en.js');
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(' ');
const tags = (s) => (String(s).match(/<\/?[a-z]+/g) || []).sort().join(' ');
let bad = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'en.js')) {
  const tr = await load(file);
  const problems = [];
  for (const key of Object.keys(en)) {
    if (key.endsWith('.one')) continue; // singular forms are optional
    if (tr[key] == null) problems.push(`missing        ${key}`);
    else if (holes(tr[key]) !== holes(en[key])) problems.push(`placeholders   ${key}: ${holes(en[key])} vs ${holes(tr[key])}`);
    else if (tags(tr[key]) !== tags(en[key])) problems.push(`html tags      ${key}`);
    else if (!String(tr[key]).trim()) problems.push(`empty          ${key}`);
  }
  for (const key of Object.keys(tr)) if (en[key] == null && !key.startsWith('err.')) problems.push(`not in English ${key}`);
  const errs = Object.keys(tr).filter((k) => k.startsWith('err.')).length;
  console.log(`${file}: ${Object.keys(tr).length} strings (${errs} error messages)${problems.length ? '' : ', all good'}`);
  for (const p of problems) console.log('   ' + p);
  bad += problems.length;
}
console.log(`\nEnglish has ${Object.keys(en).length} strings. ${bad ? bad + ' problems found' : 'No problems.'}`);
process.exitCode = bad ? 1 : 0;
