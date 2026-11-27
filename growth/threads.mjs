// Daily digest of Reddit threads where a student is asking for exactly what
// Demist does. A person reads the digest and posts any reply themselves, from
// their own account, saying they make Demist. Nothing here posts.
//
//   node growth/threads.mjs              (last 7 days, new threads only)
//   node growth/threads.mjs --days 30 --draft
//
// Needs a free Reddit "script" app (https://www.reddit.com/prefs/apps):
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME in growth/.env
// --draft also needs OPENAI_API_KEY and writes a suggested reply per thread.
// Output: growth/out/threads/<date>.md (+ growth/out/threads-seen.json)
import fs from 'node:fs';
import path from 'node:path';
import { OUT, ROOT, args, ensureDir, today, loadEnv, sleep } from './lib.mjs';

loadEnv();
const a = args();
const days = Number(a.days || 7);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'threads-config.json'), 'utf8'));
const { REDDIT_CLIENT_ID: ID, REDDIT_CLIENT_SECRET: SECRET, REDDIT_USERNAME: USER, OPENAI_API_KEY: OPENAI } = process.env;
if (!ID || !SECRET || !USER) {
  console.error('Missing REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / REDDIT_USERNAME in growth/.env.\nRegister a free "script" app at https://www.reddit.com/prefs/apps, or use F5Bot alerts instead (see growth/README.md).');
  process.exit(1);
}
// Reddit asks API clients to identify as platform:app:version (by /u/name).
const UA = `node:demist-thread-finder:1.0 (by /u/${USER})`;

async function token() {
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${ID}:${SECRET}`).toString('base64')}`, 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`Reddit auth failed: ${res.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

async function api(tok, p) {
  const res = await fetch(`https://oauth.reddit.com${p}`, { headers: { Authorization: `Bearer ${tok}`, 'User-Agent': UA } });
  // Stay well under the free limit (100 requests a minute).
  await sleep(1100);
  if (!res.ok) return null;
  return res.json();
}

function score(post) {
  const t = `${post.title} ${post.selftext || ''}`.toLowerCase();
  let s = 0;
  for (const [re, w] of cfg.signals) if (new RegExp(re, 'i').test(t)) s += w;
  if (/\?/.test(post.title)) s += 1;
  if (post.num_comments > 40) s -= 2; // already crowded, a new reply gets buried
  if (post.locked || post.archived) s -= 10;
  return s;
}

async function draft(post, rules) {
  const sys = `You help a student-support charity reply on Reddit. The reply is posted by a real person who helps make Demist, a lecture app that transcribes live, explains difficult words as the lecturer says them, writes lecture notes and translates. It runs on the student's own Windows computer, there is a Mac beta, and it has a free plan.
Write a short, genuinely useful reply to the post below:
- Answer the person's actual problem first, with practical advice that works without any app.
- If an app would help, name two or three options fairly (for example Otter, Genio, Microsoft Live Captions or the university disability service), including Demist.
- Say plainly "I help make Demist" when mentioning it. Never pretend to be a neutral user.
- Never use the word "AI", "artificial intelligence" or em dashes. No marketing language, no exclamation marks, under 120 words.
- Do not include a link unless the subreddit rules below clearly allow it; otherwise say "it's called Demist".
- Never make medical claims.
Subreddit rules: ${rules.slice(0, 1500)}`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: `r/${post.subreddit}\nTitle: ${post.title}\n\n${(post.selftext || '').slice(0, 2500)}` }],
    }),
  });
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || '').replace(/—/g, ',').replace(/\bAI\b/g, '').trim();
}

async function main() {
  ensureDir(path.join(OUT, 'threads'));
  const seenFile = path.join(OUT, 'threads-seen.json');
  const seen = new Set(fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, 'utf8')) : []);
  const tok = await token();
  const t = days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 31 ? 'month' : 'year';
  const since = Date.now() / 1000 - days * 86400;
  const found = new Map();
  const rules = {};

  for (const sub of cfg.subreddits) {
    const r = await api(tok, `/r/${sub}/about/rules`);
    rules[sub] = (r?.rules || []).map((x) => `${x.short_name}: ${x.description || ''}`).join(' | ');
    for (const q of cfg.queries) {
      const j = await api(tok, `/r/${sub}/search?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new&t=${t}&limit=50`);
      for (const c of j?.data?.children || []) {
        const p = c.data;
        if (p.created_utc < since || found.has(p.id) || (seen.has(p.id) && !a.all)) continue;
        const s = score(p);
        if (s >= cfg.min_score) found.set(p.id, { ...p, score_: s });
      }
    }
    process.stdout.write(`r/${sub} `);
  }
  const posts = [...found.values()].sort((x, y) => y.score_ - x.score_).slice(0, cfg.max_per_digest);
  console.log(`\n${posts.length} new threads worth a look.`);

  let md = `# Threads to answer, ${today()}\n\nRules: answer the problem first, name other options fairly, say "I help make Demist", no links unless the subreddit allows them, no "AI", no em dashes. Skip anything where a reply would not genuinely help.\n\n`;
  for (const p of posts) {
    const selfPromo = /self.?promo|advertis|promotion|spam|no (links|apps)/i.test(rules[p.subreddit] || '');
    md += `## ${p.title.replace(/\n/g, ' ')}\n`;
    md += `r/${p.subreddit} · ${new Date(p.created_utc * 1000).toISOString().slice(0, 10)} · ${p.num_comments} comments · score ${p.score_}${selfPromo ? ' · **sub restricts self-promotion: mention only if asked, no link**' : ''}\n`;
    md += `https://www.reddit.com${p.permalink}\n\n`;
    if (p.selftext) md += `> ${p.selftext.slice(0, 500).replace(/\n+/g, ' ')}${p.selftext.length > 500 ? '...' : ''}\n\n`;
    if (a.draft && OPENAI) md += `**Suggested reply (edit before posting):**\n\n${await draft(p, rules[p.subreddit] || '')}\n\n`;
    md += `---\n\n`;
    seen.add(p.id);
  }
  const file = path.join(OUT, 'threads', `${today()}.md`);
  fs.writeFileSync(file, md);
  fs.writeFileSync(seenFile, JSON.stringify([...seen]));
  console.log(`Digest -> ${file}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
