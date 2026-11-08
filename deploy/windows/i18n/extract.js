// Extracts candidate English UI strings from web/src into strings.json:
// { text: { n, areas: {admin, user}, files: [..up to 3] } }
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const out = process.argv[3];
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'test' && e.name !== '__tests__') walk(p); }
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.(test|spec|stories)\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(p);
  }
})(root);

const res = {};
function add(text, file, kind) {
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length < 2 || !/[A-Za-z]{2}/.test(text)) return;
  if (/^[a-z0-9_.\-/:#@]+$/.test(text)) return;          // identifiers, keys, paths
  if (/^(https?:|\/|\.|#|data:)/.test(text)) return;
  if (kind === 'tmpl') { if (/[<>;=]|=>/.test(text)) return; }
  else if (/[{}<>;=]|=>|\bclassName\b/.test(text)) return;
  if (/^[a-z][a-zA-Z0-9]*$/.test(text)) return;          // camelCase ids
  if (/^[A-Z0-9_]+$/.test(text) && text.length > 4) return; // CONSTANTS
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const area = /(^|\/)admin|Admin/.test(rel) ? 'admin' : 'user';
  const r = res[text] || (res[text] = { n: 0, admin: 0, user: 0, kinds: {}, files: [] });
  r.n++; r[area]++; r.kinds[kind] = (r.kinds[kind] || 0) + 1;
  if (r.files.length < 3 && !r.files.includes(rel)) r.files.push(rel);
}

const propRe = /\b(label|title|placeholder|description|aria-label|ariaLabel|emptyText|emptyMessage|message|heading|subtitle|helperText|hint|tooltip|confirmLabel|cancelLabel|actionLabel|submitLabel|text|summary|caption|name|unsetLabel|empty|body|detail|reason|alt)\s*[:=]\s*(?:\{\s*)?(["'])((?:\\.|(?!\2).){2,300}?)\2/g;
const callRe = /\b(?:toast(?:\.\w+)?|notify|setError|showToast|confirm|alert|new Error|t)\(\s*(["'])((?:\\.|(?!\1).){2,300}?)\1/g;
const ternRe = /[?:]\s*(["'])([A-Z][^"'\n]{1,200}?)\1/g;
const tmplRe = /`([^`$]*(?:\$\{[^}]+\}[^`$]*)+)`/g;

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const code = src.replace(/^\s*import[^;]+;/gm, '').replace(/\/\/[^\n]*/g, (m) => (m.includes('http') ? m : '')).replace(/\/\*[\s\S]*?\*\//g, '');
  if (f.endsWith('.tsx')) {
    // JSX text between tags, stopping at expressions.
    const jsxRe = /[>}]([^<>{}]*[A-Za-z][^<>{}]*)(?=[<{])/g;
    let m;
    while ((m = jsxRe.exec(code))) {
      const t = m[1];
      if (/[;=()?:&|\[\]]|\b(const|return|function|import|export|if|else|null|undefined|true|false)\b/.test(t)) continue;
      if (m[0][0] === '}' && !/[A-Za-z]{2,}/.test(t.trim())) continue;
      if (m[0][0] === '}' && /^[\s,]*$/.test(t)) continue;
      add(m[0][0] === '}' ? t : t, f, m[0][0] === '}' ? 'frag' : 'jsx');
    }
  }
  let m;
  while ((m = propRe.exec(code))) add(m[3].replace(/\\(["'])/g, '$1'), f, 'prop');
  while ((m = callRe.exec(code))) add(m[2].replace(/\\(["'])/g, '$1'), f, 'call');
  while ((m = ternRe.exec(code))) if (/\s/.test(m[2]) || /^[A-Z][a-z]+$/.test(m[2])) add(m[2], f, 'tern');
  while ((m = tmplRe.exec(code))) {
    const t = m[1];
    const bare = t.replace(/\$\{[^}]+\}/g, '');
    if (!/[A-Za-z]{3}/.test(bare)) continue;
    if (!/(^|\s)[A-Za-z][a-z]{2,}(\s|$|[.,!:])/.test(bare)) continue;
    if (/(\bpx\b|rem\b|\/api\/|\/v\d\/|[?&=]|--|\b(bg|text|w|h|p|m|px|py|mx|my|flex|grid|border|rounded|col|row|gap)-)/.test(bare)) continue;
    let i = 0;
    add(t.replace(/\$\{[^}]+\}/g, () => '{' + (i++) + '}'), f, 'tmpl');
  }
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
const all = Object.entries(res);
console.log('unique', all.length, 'user-only', all.filter(([, r]) => r.user > 0).length, 'admin-only', all.filter(([, r]) => r.user === 0).length, 'tmpl', all.filter(([, r]) => r.kinds.tmpl).length);
