// Lists interface strings in web/src that de.tsv does not translate yet,
// for example after an upstream Silo update.
//
//   node deploy/windows/i18n/missing.js [user|admin|all] > missing.txt
//
// Output lines are "English<TAB>" grouped by source file; fill in the German
// after the tab and append them to de.tsv. Lines that are code rather than
// interface text (class names, identifiers) can simply be left out.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const here = __dirname;
const area = process.argv[2] || 'all';
const tmp = path.join(os.tmpdir(), `silo-i18n-strings-${process.pid}.json`);
execFileSync(process.execPath, [path.join(here, 'extract.js'), path.resolve(here, '../../../web/src'), tmp], { stdio: 'ignore' });
const strings = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

const known = new Set();
for (const line of fs.readFileSync(path.join(here, 'de.tsv'), 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.startsWith('#')) continue;
  known.add(line.slice(0, line.indexOf('\t')).replace(/\s+/g, ' ').trim());
}
// Translated earlier but deliberately left English: identifiers, class names,
// brand names. Keep them out of the report.
const skipFile = path.join(here, 'skip.txt');
if (fs.existsSync(skipFile)) {
  for (const l of fs.readFileSync(skipFile, 'utf8').split(/\r?\n/)) if (l.trim() && !l.startsWith('#')) known.add(l.trim());
}

const noise = (t) =>
  /\binterface [A-Z]|\$$|^\$|^silo\.|^v2:|Bearer |\bfunction\b|\bexport\b|\breturn\b|\bconst\b|=>|\(\)|^[^A-Za-z]*$/.test(t) ||
  (/^[A-Z][a-zA-Z]+[A-Z][a-zA-Z]*$/.test(t) && !/\s/.test(t)) ||
  /^\{\d+\}([^A-Za-z]*\{\d+\})*[^A-Za-z]*$/.test(t) ||
  /^[a-z]+(-[a-z]+)+$/.test(t) ||
  /(^|\s)(absolute|relative|flex|grid|text-|bg-|rounded|pointer-events)/.test(t);

const byFile = new Map();
let n = 0;
for (const [en, v] of Object.entries(strings)) {
  if (known.has(en) || noise(en)) continue;
  const isUser = v.user > 0;
  if ((area === 'user' && !isUser) || (area === 'admin' && isUser)) continue;
  const f = v.files[0];
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(en);
  n++;
}
for (const f of [...byFile.keys()].sort()) {
  console.log(`# ${f}`);
  for (const en of byFile.get(f).sort()) console.log(`${en}\t`);
}
console.error(`${n} untranslated ${area} string(s)`);
