// Asks student-style questions to a search-enabled assistant, records whether
// Demist is named and which pages are cited, then checks each cited page for
// a Demist mention. Pages that are cited but don't name us are the outreach
// "ballot": the lists, threads and university pages to get onto.
//
//   node growth/citations.mjs            (all prompts, both countries)
//   node growth/citations.mjs --only adhd --country GB
//
// Needs OPENAI_API_KEY in growth/.env. Roughly 36 searches per full run.
// Output: growth/out/citations/<date>.json, growth/out/citations-history.csv,
// growth/out/ballot.csv
import fs from 'node:fs';
import path from 'node:path';
import { OUT, ROOT, args, ensureDir, fetchText, allowed, pool, toCsv, htmlToText, pageTitle, toolsIn, today, loadEnv, TOOLS } from './lib.mjs';

loadEnv();
const a = args();
const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.CITATIONS_MODEL || 'gpt-4.1-mini';
const TOOL = process.env.CITATIONS_TOOL || 'web_search';
if (!KEY) {
  console.error('Missing OPENAI_API_KEY. Add it to growth/.env (that file is git-ignored).');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts.json'), 'utf8'));
const countries = a.country ? [a.country] : cfg.countries;
const prompts = cfg.prompts.filter((p) => !a.only || p.tag === a.only);

async function ask(q, country) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      tools: [{ type: TOOL, user_location: { type: 'approximate', country } }],
      input: q,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${j?.error?.message || JSON.stringify(j).slice(0, 300)}`);
  let text = '';
  const cites = [];
  for (const item of j.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type !== 'output_text') continue;
      text += c.text;
      for (const ann of c.annotations || []) if (ann.type === 'url_citation') cites.push({ url: ann.url, title: ann.title });
    }
  }
  return { text, cites, usage: j.usage };
}

// Order in which products are first named, so we can see where Demist ranks.
function namedOrder(text) {
  return TOOLS.map((t) => ({ t, i: text.search(new RegExp(`\\b${t.replace(/[.&]/g, (c) => `\\${c}`)}\\b`, 'i')) }))
    .filter((x) => x.i >= 0)
    .sort((x, y) => x.i - y.i)
    .map((x) => x.t);
}

const clean = (u) => {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^utm_/.test(k)) x.searchParams.delete(k);
    x.hash = '';
    return x.href;
  } catch {
    return u;
  }
};

async function main() {
  ensureDir(path.join(OUT, 'citations'));
  const jobs = countries.flatMap((country) => prompts.map((p) => ({ ...p, country })));
  console.log(`Asking ${jobs.length} questions with ${MODEL}...`);
  let tokens = 0;
  const results = await pool(jobs, 3, async (job) => {
    const r = await ask(job.q, job.country);
    tokens += (r.usage?.input_tokens || 0) + (r.usage?.output_tokens || 0);
    const order = namedOrder(r.text);
    const rank = order.indexOf('Demist') + 1;
    console.log(`${job.country} [${job.tag}] ${rank ? `Demist #${rank}` : 'no Demist'} | ${order.slice(0, 5).join(', ')} | ${job.q}`);
    return { ...job, date: today(), demist_rank: rank || '', named: order, cites: r.cites.map((c) => ({ ...c, url: clean(c.url) })), answer: r.text };
  });
  const done = results.filter(Boolean);
  fs.writeFileSync(path.join(OUT, 'citations', `${today()}.json`), JSON.stringify(done, null, 2));

  const hist = path.join(OUT, 'citations-history.csv');
  const cols = ['date', 'country', 'tag', 'q', 'demist_rank', 'named', 'cited_domains'];
  const rows = done.map((r) => ({ ...r, cited_domains: [...new Set(r.cites.map((c) => new URL(c.url).hostname))] }));
  if (!fs.existsSync(hist)) fs.writeFileSync(hist, toCsv(rows, cols));
  else fs.appendFileSync(hist, toCsv(rows, cols).split('\n').slice(1).join('\n'));

  // The ballot: every cited page, how often, and whether it already names us.
  const pages = new Map();
  for (const r of done) for (const c of r.cites) {
    const p = pages.get(c.url) || { url: c.url, title: c.title, times_cited: 0, prompts: new Set() };
    p.times_cited++;
    p.prompts.add(`${r.country}:${r.tag}`);
    pages.set(c.url, p);
  }
  const list = [...pages.values()];
  await pool(list, 4, async (p) => {
    p.domain = new URL(p.url).hostname;
    if (!(await allowed(p.url))) { p.status = 'robots disallow'; return; }
    const res = await fetchText(p.url);
    p.status = res.status;
    if (res.status === 200 && res.text) {
      const text = htmlToText(res.text);
      p.title = p.title || pageTitle(res.text);
      p.names_demist = /\bdemist\b/i.test(text) ? 'yes' : 'no';
      p.tools_named = toolsIn(text).filter((t) => t !== 'Demist');
      p.kind = /reddit\.com/.test(p.domain) ? 'reddit' : /youtube\.com|youtu\.be/.test(p.domain) ? 'video'
        : /\.(ac\.uk|edu)$/.test(p.domain) ? 'university' : /\b(best|top \d|alternatives|vs\b|review)/i.test(p.title + p.url) ? 'list/review' : 'other';
    }
  });
  list.forEach((p) => (p.prompts = [...p.prompts]));
  list.sort((x, y) => Number(x.names_demist === 'yes') - Number(y.names_demist === 'yes') || y.times_cited - x.times_cited);
  fs.writeFileSync(path.join(OUT, 'ballot.csv'), toCsv(list, ['times_cited', 'names_demist', 'kind', 'domain', 'title', 'url', 'tools_named', 'prompts', 'status']));

  const named = done.filter((r) => r.demist_rank).length;
  console.log(`\nDemist named in ${named} of ${done.length} answers. ${list.length} pages cited, ${list.filter((p) => p.names_demist === 'yes').length} of them name Demist.`);
  console.log(`Tokens used: ${tokens}. Ballot -> ${path.join(OUT, 'ballot.csv')}`);
}

main();
