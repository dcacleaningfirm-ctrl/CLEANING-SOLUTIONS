import fs from 'node:fs';
import path from 'node:path';

// Run after page generators. Omit lastmod until content-specific dates are
// available: deployment time is not evidence that page content changed.
const origin = 'https://www.dcacleaningsolutions.com';
const excluded = new Set(['node_modules', '.git', '.netlify', 'manager', 'app', 'tools', 'tests', 'netlify']);
const urls = new Set();
// Apply the official dynamic BBB seal after every public page generator.
// Keep the image remote so BBB controls the current seal and rating.
const bbbSeal = `<div class="bbb-accreditation" style="padding:24px 16px;text-align:center"><a href="https://www.bbb.org/us/ga/forest-park/profile/carpet-and-rug-cleaners/dca-cleaning-solutions-0443-91851079/#sealclick" target="_blank" rel="nofollow noopener"><img src="https://seal-atlanta.bbb.org/seals/blue-seal-200-42-bbb-91851079.png" width="200" height="42" loading="lazy" style="border:0;display:inline-block;width:200px;max-width:100%;height:auto" alt="DCA Cleaning Solutions BBB Business Review" /></a></div>`;
let sealedPages = 0;
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
    if (/<footer\b/i.test(html) && !html.includes('seal-atlanta.bbb.org/seals/blue-seal-200-42-bbb-91851079.png')) {
      fs.writeFileSync(file, html.replace(/<\/footer>/i, bbbSeal + '\n</footer>'));
      sealedPages++;
    }
    urls.add(url.href);
  }
}
walk('.');
if (!urls.has(origin + '/') || !urls.has(origin + '/carpet-cleaning')) throw new Error('Required public pages missing');
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + [...urls].sort().map(url => `  <url><loc>${url.replaceAll('&', '&amp;')}</loc></url>`).join('\n') + '\n</urlset>\n';
fs.writeFileSync('sitemap.xml', xml);
console.log(`Search sitemap validated: ${urls.size} canonical public pages.`);

console.log(`Official BBB seal added to ${sealedPages} public page footers.`);
