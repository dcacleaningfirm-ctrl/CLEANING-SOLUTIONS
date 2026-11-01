import fs from 'node:fs';
import path from 'node:path';

// Run after page generators. Omit lastmod until content-specific dates are
// available: deployment time is not evidence that page content changed.
const origin = 'https://www.dcacleaningsolutions.com';
const excluded = new Set(['node_modules', '.git', '.netlify', 'manager', 'app', 'tools', 'tests', 'netlify']);
const urls = new Set();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const html = fs.readFileSync(file, 'utf8');
    if (/<meta\b[^>]*\bcontent=["'][^"']*noindex/i.test(html)) continue;
    const canonical = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i)?.[1];
    if (!canonical) continue;
    const url = new URL(canonical);
    if (url.origin !== origin || url.search || url.hash) continue;
    if (/^\/(manager|app|api|install|pay)(\/|$)/.test(url.pathname)) continue;
    // Only list canonical pages actually present in this build.
    const route = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    if (![route + '.html', path.join(route, 'index.html')].some(p => fs.existsSync(p))) continue;
    urls.add(url.href);
  }
}
walk('.');
if (!urls.has(origin + '/') || !urls.has(origin + '/carpet-cleaning')) throw new Error('Required public pages missing');
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + [...urls].sort().map(url => `  <url><loc>${url.replaceAll('&', '&amp;')}</loc></url>`).join('\n') + '\n</urlset>\n';
fs.writeFileSync('sitemap.xml', xml);
console.log(`Search sitemap validated: ${urls.size} canonical public pages.`);
