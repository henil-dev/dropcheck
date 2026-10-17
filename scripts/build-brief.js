// Turns docs/product-brief.md into docs/brief.html.
// Print that file to PDF (the repo uses headless Edge/Chrome) to get docs/product-brief.pdf.
import { readFileSync, writeFileSync } from 'node:fs';
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
  th { background: #f0eee8; }
  blockquote { border-left: 3px solid #b5542a; margin: 8px 0; padding: 2px 12px; background: #faf8f4; }
  hr { border: 0; border-top: 1px solid #ccc; }
  code { font-size: 9pt; background: #f0eee8; padding: 0 3px; }
</style></head><body>${body}</body></html>`;

writeFileSync('docs/brief.html', html);
console.log('wrote docs/brief.html');
