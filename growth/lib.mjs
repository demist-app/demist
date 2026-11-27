// Shared helpers for the growth tools. No dependencies: Node 20+ only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(ROOT, 'out');

// Honest crawler identity. Never pretend to be a browser: sites that refuse
// scripts get skipped, not worked around.
export const UA = 'DemistOutreachBot/1.0 (+https://demist.app)';

export function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const key = a[i].slice(2);
    out[key] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  }
  return out;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { timeout = 15000, headers = {}, method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      body,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,text/xml,*/*', ...headers },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const type = res.headers.get('content-type') || '';
    // Skip PDFs and other binaries: we only read pages.
    if (!/text|xml|json|html/i.test(type) && !/\.xml(\.gz)?$/i.test(url)) {
      return { status: res.status, url: res.url, text: '', type };
    }
    const text = await res.text();
    return { status: res.status, url: res.url, text: text.slice(0, 3_000_000), type };
  } catch (e) {
    return { status: 0, url, text: '', error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// Minimal robots.txt support: the `User-agent: *` group's Disallow prefixes,
// plus any Sitemap lines. Good enough to stay out of places a site asked
// crawlers to avoid.
const robotsCache = new Map();
export async function robots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const res = await fetchText(`${origin}/robots.txt`, { timeout: 10000 });
  const rules = { disallow: [], allow: [], sitemaps: [], reachable: res.status > 0 };
  if (res.status === 200) {
    let applies = false;
    for (const raw of res.text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === 'sitemap') rules.sitemaps.push(val);
      else if (key === 'user-agent') applies = val === '*' || /demist/i.test(val);
      else if (applies && key === 'disallow' && val) rules.disallow.push(val);
      else if (applies && key === 'allow' && val) rules.allow.push(val);
    }
  }
  robotsCache.set(origin, rules);
  return rules;
}

export async function allowed(url) {
  const u = new URL(url);
  const r = await robots(u.origin);
  const p = u.pathname + u.search;
  const match = (list) => list.filter((rule) => p.startsWith(rule.replace(/\*.*$/, ''))).reduce((m, x) => Math.max(m, x.length), -1);
  return match(r.allow) >= match(r.disallow);
}

export async function pool(items, n, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          results[idx] = await fn(items[idx], idx);
        } catch (e) {
          console.error(`  error on item ${idx}: ${e?.stack || e}`);
          results[idx] = null;
        }
      }
    }),
  );
  return results;
}

export function toCsv(rows, cols) {
  const esc = (v) => {
    const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#64;|&commat;/g, '@')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pageTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).slice(0, 160) : '';
}

// Products students and disability offices name for lecture capture and
// note-taking. Used to spot pages that already recommend tools like ours.
export const TOOLS = [
  'Genio', 'Glean', 'Otter', 'Sonocent', 'Audio Notetaker', 'Notetalker', 'Caption.Ed', 'Jamworks',
  'Notability', 'Livescribe', 'Read&Write', 'Dragon', 'Microsoft Live Captions', 'Live Transcribe',
  'Speakwise', 'Turbolearn', 'Knowt', 'StudyFetch', 'Mindgrasp', 'Plaud', 'Coconote', 'Demist',
];

export function toolsIn(text) {
  return TOOLS.filter((t) => new RegExp(`\\b${t.replace(/[.&]/g, (c) => `\\${c}`)}\\b`, 'i').test(text));
}
