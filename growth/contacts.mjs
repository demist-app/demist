// Finds a public contact route for each list article we want to be on:
// emails on the article, its site's contact/about pages, or a contact form.
//
//   node growth/contacts.mjs <url> [<url> ...]
//
// Writes growth/out/list-contacts.csv. Obeys robots.txt. Only role or
// editorial addresses published by the site itself.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, fetchText, allowed, htmlToText, pageTitle, toCsv, sleep } from './lib.mjs';

const urls = process.argv.slice(2).filter((u) => /^https?:/.test(u));
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JUNK = /(example\.|sentry|wixpress|\.png|\.jpg|\.webp|@2x|domain\.com|email\.com|yourname)/i;

function author(html) {
  const meta = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)/i)?.[1];
  const ld = html.match(/"author"\s*:\s*(?:\[\s*)?\{[^}]*"name"\s*:\s*"([^"]+)"/i)?.[1];
  return meta || ld || '';
}

async function scan(url) {
  const u = new URL(url);
  const pages = [url, `${u.origin}/contact`, `${u.origin}/contact-us`, `${u.origin}/about`, `${u.origin}/about-us`, `${u.origin}/write-for-us`];
  const emails = new Set();
  const forms = [];
  let title = '', by = '';
  for (const p of pages) {
    if (!(await allowed(p))) continue;
    const res = await fetchText(p);
    await sleep(400);
    if (res.status !== 200 || !res.text) continue;
    if (p === url) { title = pageTitle(res.text); by = author(res.text); }
    const decoded = res.text.replace(/&#64;|&commat;|\s?\[at\]\s?|\s?\(at\)\s?/gi, '@');
    for (const e of decoded.match(EMAIL) || []) if (!JUNK.test(e)) emails.add(e.toLowerCase());
    if (p !== url && /<form/i.test(res.text) && /(message|email)/i.test(htmlToText(res.text).slice(0, 20000))) forms.push(res.url);
  }
  return { url, site: u.hostname, title, author: by, emails: [...emails].slice(0, 5), contact_form: forms[0] || '' };
}

const rows = [];
for (const u of urls) {
  const r = await scan(u);
  rows.push(r);
  console.log(`${r.site}: ${r.emails.join(', ') || '(no email)'}${r.contact_form ? ` | form ${r.contact_form}` : ''}${r.author ? ` | by ${r.author}` : ''}`);
}
fs.writeFileSync(path.join(OUT, 'list-contacts.csv'), toCsv(rows, ['site', 'title', 'author', 'emails', 'contact_form', 'url']));
