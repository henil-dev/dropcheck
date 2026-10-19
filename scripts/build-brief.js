// Turns docs/product-brief.md into docs/brief.html, then prints it to docs/product-brief.pdf
// with headless Edge or Chrome (whichever is installed).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';

const md = readFileSync('docs/product-brief.md', 'utf8');
const body = marked.parse(md);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Dropcheck - Product Brief</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 10.5pt; line-height: 1.5; color: #1d1d1b; }
  h1 { font-size: 22pt; margin: 0 0 4px; }
  h2 { font-size: 13.5pt; margin: 22px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; page-break-after: avoid; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 8px 0; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eef0f3; }
  blockquote { border-left: 3px solid #2a4fb0; margin: 8px 0; padding: 2px 12px; background: #f5f6f8; }
  hr { border: 0; border-top: 1px solid #ccc; }
  a { color: #2a4fb0; }
  table.details { width: auto; min-width: 60%; font-size: 10pt; margin: 14px 0 6px; border: 0; border-left: 3px solid #2a4fb0; }
  table.details th, table.details td { border: 0; border-bottom: 1px solid #e2e5ea; padding: 5px 14px; }
  table.details th { background: none; color: #5d6570; font-weight: normal; width: 110px; white-space: nowrap; }
  table.details td { font-weight: bold; }
  code { font-size: 9pt; background: #eef0f3; padding: 0 3px; }
</style></head><body>${body}</body></html>`;

writeFileSync('docs/brief.html', html);
console.log('wrote docs/brief.html');

const browsers = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const browser = browsers.find((b) => existsSync(b));
if (!browser) {
  console.log('No Edge/Chrome found: open docs/brief.html and print it to PDF.');
} else {
  const out = path.resolve('docs/product-brief.pdf');
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${out}`, pathToFileURL(path.resolve('docs/brief.html')).href], { stdio: 'ignore' });
  console.log('wrote docs/product-brief.pdf');
}
