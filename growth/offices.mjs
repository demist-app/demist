// Finds university disability / accessibility pages that talk about
// note-taking or assistive technology, which tools they already name, and the
// office's public contact address. Output feeds the outreach list.
//
//   node growth/offices.mjs --country "United Kingdom" --limit 20
//   node growth/offices.mjs --country "United States" --offset 200 --limit 200
//
// Free: reads each university's own sitemap, obeys robots.txt, one request at
// a time per site. Results append to growth/out/offices.csv (re-runs skip
// universities already done; pass --redo to scan them again).
import fs from 'node:fs';
import path from 'node:path';
import {
  OUT, args, ensureDir, fetchText, robots, allowed, pool, toCsv, htmlToText, pageTitle, toolsIn, sleep,
} from './lib.mjs';

const UNI_LIST = 'https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json';
const a = args();
const countries = String(a.country || 'United Kingdom,United States').split(',').map((s) => s.trim());
const offset = Number(a.offset || 0);
const limit = Number(a.limit || 25);
const concurrency = Number(a.concurrency || 4);
const MAX_SITEMAPS = 40;
const MAX_PAGES = 6;

// URL scoring: where in a university site the disability office and its
// note-taking advice usually live.
const OFFICE = /(disab|accessib|access-?abilit|inclusi|neurodiver|dyslex|adhd|learning-support|academic-accommodations|reasonable-adjust|\/drc\b|\/ssd\b|\/sas\b)/i;
const HOUSING = /(accommodation|halls|housing|residence|parking|travel)/i;
// What counts as the page actually discussing lecture note-taking support.
const ON_TOPIC = /(note-?taking|notetaking|note-?taker|lecture capture|record(ing)? (of )?lectures|lecture recording|assistive (technology|software)|transcription software|live captions)/i;
const TOPIC = /(note-?tak|notetak|assistive|software|technolog|lecture-?capt|recording|transcri|apps?\b|tools?\b|dsa\b)/i;
const SUPPORT = /(student-?support|wellbeing|student-?services|student-?life)/i;
const SKIP = /\.(pdf|docx?|pptx?|xlsx?|jpe?g|png|gif|svg|css|js|mp4|mp3|zip)(\?|$)/i;
// Corporate pages that match the words above but are never the student office.
const CORPORATE = /(governance|legal|statement|charter|athena|employer|freedom-of-information|foi|policy|policies|reporting|harassment|careers|jobs|vacanc|\/cy\/|staff)/i;

function scoreUrl(u) {
  let s = 0;
  if (OFFICE.test(u)) s += 3;
  if (TOPIC.test(u)) s += 3;
  if (SUPPORT.test(u)) s += 1;
  if (/news|blog|event|story|stories|press|20\d\d\//i.test(u)) s -= 3;
  if (HOUSING.test(u) && !OFFICE.test(u)) s -= 4;
  if (CORPORATE.test(u)) s -= 3;
  if (/inclusi/i.test(u) && !/(disab|neurodiver|dyslex|learning-support|student)/i.test(u)) s -= 2;
  return s;
}

async function sitemapUrls(origin) {
  const r = await robots(origin);
  const queue = r.sitemaps.length ? [...r.sitemaps] : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seen = new Set();
  const urls = [];
  let fetched = 0;
  while (queue.length && fetched < MAX_SITEMAPS) {
    // Prefer child sitemaps that look like pages or student areas.
    queue.sort((x, y) => scoreUrl(y) + (/page/i.test(y) ? 1 : 0) - (scoreUrl(x) + (/page/i.test(x) ? 1 : 0)));
    const sm = queue.shift();
    if (seen.has(sm) || /\.gz$/i.test(sm)) continue;
    seen.add(sm);
    fetched++;
    const res = await fetchText(sm, { timeout: 20000 });
    if (res.status !== 200 || !res.text) continue;
    const locs = [...res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(res.text)) queue.push(...locs);
    else urls.push(...locs);
    await sleep(300);
  }
  return { urls, sitemapsRead: fetched };
}

function emailsIn(html, domain) {
  const text = html.replace(/&#64;|&commat;|\s?\[at\]\s?|\s?\(at\)\s?/gi, '@');
  const all = [...new Set((text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e) => e.toLowerCase()))];
  const base = domain.replace(/^www\./, '').split('.').slice(-3).join('.');
  const own = all.filter((e) => e.endsWith(base) || e.split('@')[1].endsWith(domain.replace(/^www\./, '')));
  // Shared office inboxes only. Named staff addresses (j.smith@, jane.smith@)
  // are personal data and not who we should be writing to.
  const pick = own.filter((e) => !/^[a-z]{1,2}\.[a-z'-]+\d*@|^[a-z]+\.[a-z'-]+\d*@/.test(e) || OFFICE.test(e.split('@')[0]));
  return pick.sort((x, y) => Number(OFFICE.test(y) || /support|enquir|info/.test(y)) - Number(OFFICE.test(x) || /support|enquir|info/.test(x)));
}

function linksIn(html, pageUrl, origin) {
  const host = new URL(origin).hostname.replace(/^www\./, '');
  const out = [];
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), pageUrl);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.replace(/^www\./, '').endsWith(host) || SKIP.test(u.pathname)) continue;
      u.hash = '';
      if (scoreUrl(u.href) >= 3) out.push(u.href);
    } catch {}
  }
  return [...new Set(out)];
}

async function scanUniversity(uni) {
  const domain = uni.domains[0];
  let origin = null;
  for (const o of [`https://www.${domain.replace(/^www\./, '')}`, `https://${domain}`]) {
    const r = await robots(o);
    if (r.reachable) { origin = o; break; }
  }
  const base = { university: uni.name, country: uni.country, domain };
  if (!origin) return [{ ...base, status: 'unreachable' }];

  const { urls, sitemapsRead } = await sitemapUrls(origin);
  const candidates = [...new Set(urls)]
    .filter((u) => !SKIP.test(u) && scoreUrl(u) >= 3)
    .sort((x, y) => scoreUrl(y) - scoreUrl(x) || x.length - y.length);

  // No usable sitemap: start from the home page and student pages instead.
  if (!candidates.length) {
    for (const start of [origin, `${origin}/students`, `${origin}/student-life`, `${origin}/study`]) {
      if (!(await allowed(start))) continue;
      const res = await fetchText(start);
      await sleep(400);
      if (res.status === 200) for (const l of linksIn(res.text, res.url, origin)) if (!candidates.includes(l)) candidates.push(l);
    }
    candidates.sort((x, y) => scoreUrl(y) - scoreUrl(x));
  }

  const picked = [];
  for (const u of candidates) {
    if (picked.length >= MAX_PAGES) break;
    if (await allowed(u)) picked.push(u);
  }
  if (!picked.length) return [{ ...base, status: urls.length ? 'no matching pages' : `no sitemap (${sitemapsRead} read), nothing linked` }];

  // Office pages link on to their assistive-technology pages: follow those
  // one level, up to MAX_PAGES + 4 pages per university.
  const extra = [];
  const rows = [];
  const visited = new Set();
  const visit = async (u, collect) => {
    if (visited.has(u)) return;
    visited.add(u);
    const res = await fetchText(u);
    await sleep(500);
    if (res.status !== 200 || !res.text) return;
    visited.add(res.url);
    const text = htmlToText(res.text);
    const tools = toolsIn(text);
    const hit = text.match(ON_TOPIC);
    if (collect) for (const link of linksIn(res.text, res.url, origin)) if (!extra.includes(link)) extra.push(link);
    rows.push({
      ...base,
      status: 'ok',
      page_url: res.url,
      page_title: pageTitle(res.text),
      url_score: scoreUrl(u),
      tools_named: tools,
      mentions_notetaking: hit ? hit[0].toLowerCase() : '',
      emails: emailsIn(res.text, domain).slice(0, 4),
    });
  };
  for (const u of picked) await visit(u, true);
  // Second pass: the best-looking pages the office pages link to.
  const next = extra
    .filter((l) => !visited.has(l))
    .sort((x, y) => Number(ON_TOPIC.test(y.replace(/[-_/]/g, ' '))) - Number(ON_TOPIC.test(x.replace(/[-_/]/g, ' '))) || scoreUrl(y) - scoreUrl(x));
  let followed = 0;
  for (const l of next) {
    if (followed >= 4) break;
    if (!(await allowed(l))) continue;
    followed++;
    await visit(l, false);
  }
  return rows.length ? rows : [{ ...base, status: 'pages unreadable' }];
}

const COLS = ['university', 'country', 'domain', 'status', 'page_url', 'page_title', 'url_score', 'mentions_notetaking', 'tools_named', 'emails'];

// One row per university: the inbox to write to and the page worth quoting.
const OFFICE_INBOX = /(disab|access|inclus|neurodiv|dyslex|atech|assistive|ssd|drc|sas|learning|support|wellbeing|studentservices|student\.services)/i;
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
function writeSummary(csvPath) {
  const all = parseCsv(fs.readFileSync(csvPath, 'utf8')).filter((r) => r.status === 'ok');
  const by = new Map();
  for (const r of all) (by.get(r.domain) || by.set(r.domain, []).get(r.domain)).push(r);
  const out = [];
  for (const [domain, rs] of by) {
    const rank = (r) => (r.mentions_notetaking ? 10 : 0) + (r.tools_named ? 5 : 0) + Number(r.url_score || 0) + (/disab|neurodiver|dyslex|assistive/i.test(r.page_url) ? 3 : 0);
    const best = [...rs].sort((x, y) => rank(y) - rank(x))[0];
    const emails = [...new Set(rs.flatMap((r) => (r.emails ? r.emails.split('; ') : [])))];
    // Disability / assistive-tech inboxes first, then accessibility, then general support.
    const w = (e) => {
      const l = e.split('@')[0];
      if (/disab|neurodiv|dyslex|atech|assistive|ssd|drc|^sas$|inclusivesupport|learningsupport/.test(l)) return 3;
      if (/access|inclus/.test(l) && !/elearn|digital|web/.test(l)) return 2;
      if (/wellbeing|counsel|mental/.test(l)) return 0;
      return 1;
    };
    const inbox = emails.filter((e) => OFFICE_INBOX.test(e.split('@')[0])).sort((x, y) => w(y) - w(x));
    const tools = [...new Set(rs.flatMap((r) => (r.tools_named ? r.tools_named.split('; ') : [])))];
    out.push({
      university: best.university, country: best.country, domain,
      inbox: inbox[0] || '', other_inboxes: inbox.slice(1, 3),
      best_page: best.page_url, best_page_title: best.page_title,
      topic_seen: [...new Set(rs.map((r) => r.mentions_notetaking).filter(Boolean))],
      tools_named: tools,
      priority: (inbox.length ? 2 : 0) + (rs.some((r) => r.mentions_notetaking) ? 2 : 0) + (tools.length ? 1 : 0),
    });
  }
  out.sort((x, y) => y.priority - x.priority || x.university.localeCompare(y.university));
  const file = path.join(OUT, 'offices-best.csv');
  fs.writeFileSync(file, toCsv(out, ['priority', 'university', 'country', 'domain', 'inbox', 'other_inboxes', 'best_page', 'best_page_title', 'topic_seen', 'tools_named']));
  console.log(`Summary: ${out.length} universities, ${out.filter((r) => r.inbox).length} with an office inbox -> ${file}`);
}

async function main() {
  ensureDir(OUT);
  const cache = path.join(OUT, 'universities.json');
  let list;
  if (fs.existsSync(cache)) list = JSON.parse(fs.readFileSync(cache, 'utf8'));
  else {
    const res = await fetchText(UNI_LIST, { timeout: 60000 });
    list = JSON.parse(res.text);
    fs.writeFileSync(cache, JSON.stringify(list));
  }
  const csvPath = path.join(OUT, 'offices.csv');
  const done = new Set();
  if (fs.existsSync(csvPath) && !a.redo) {
    for (const line of fs.readFileSync(csvPath, 'utf8').split('\n').slice(1)) {
      const d = line.match(/,([a-z0-9.-]+\.[a-z]{2,}),/i);
      if (d) done.add(d[1]);
    }
  }
  const unis = list
    .filter((u) => countries.includes(u.country) && u.domains?.length && !done.has(u.domains[0]))
    .slice(offset, offset + limit);
  console.log(`Scanning ${unis.length} universities (${countries.join(', ')}), ${done.size} already done.`);

  let n = 0;
  const results = await pool(unis, concurrency, async (u) => {
    const rows = await scanUniversity(u);
    const hits = rows.filter((r) => r.mentions_notetaking || r.tools_named?.length);
    console.log(`[${++n}/${unis.length}] ${u.name}: ${rows[0].status}${hits.length ? `, ${hits.length} relevant page(s)` : ''}`);
    return rows;
  });

  const rows = results.flat().filter(Boolean);
  const header = !fs.existsSync(csvPath) || a.redo;
  const csv = toCsv(rows, COLS);
  if (header) fs.writeFileSync(csvPath, csv);
  else fs.appendFileSync(csvPath, csv.split('\n').slice(1).join('\n'));
  const relevant = rows.filter((r) => r.mentions_notetaking || r.tools_named?.length);
  writeSummary(csvPath);
  console.log(`\nWrote ${rows.length} rows to ${csvPath}. Relevant pages: ${relevant.length}. With an email: ${relevant.filter((r) => r.emails?.length).length}.`);
}

main();
