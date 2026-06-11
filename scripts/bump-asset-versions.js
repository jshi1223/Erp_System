const fs = require('fs');
const path = require('path');

const NEW = process.argv[2] || '20260611fix';
const targets = [
  'shared-ui.css', 'warm-minimal.css', 'auth-guard.js', 'workspace-switcher.js',
  'erp-core.js', 'admin.js', 'inventory.js', 'inventory.css', 'sales-management.js',
  'accounts-payable.js', 'accounts-receivable.js', 'company.js', 'admin.css'
];

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.codex')) continue;
      walk(p, acc);
    } else if (e.name.endsWith('.html')) {
      acc.push(p);
    }
  }
  return acc;
}

const files = walk('public', []);
let changed = 0, hits = 0;
for (const f of files) {
  const before = fs.readFileSync(f, 'utf8');
  let html = before;
  for (const t of targets) {
    const re = new RegExp('(' + t.replace(/\./g, '\\.') + '\\?v=)[^"\'\\s>]*', 'g');
    html = html.replace(re, (m, p1) => { hits++; return p1 + NEW; });
  }
  if (html !== before) { fs.writeFileSync(f, html, 'utf8'); changed++; }
}
console.log('HTML files updated:', changed, '| version refs bumped:', hits);
