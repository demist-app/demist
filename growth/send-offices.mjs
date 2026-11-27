// Emails university disability offices from growth/out/offices-best.csv,
// each with its own offer link (demist.app/uni/<code>, migration 044).
//
//   node growth/send-offices.mjs --limit 10          (dry run: writes out/outbox/<date>.md)
//   node growth/send-offices.mjs --limit 10 --send   (creates the offers and sends)
//
// Sends through Resend from the demist.app domain the app already uses.
// Needs RESEND_API_KEY in growth/.env; Supabase keys come from web/.env.local.
// Never emails an address twice (out/sent.csv) or anyone in out/do-not-contact.txt.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, ROOT, args, loadEnv, toCsv, today, sleep } from './lib.mjs';

loadEnv();
for (const line of fs.readFileSync(path.join(ROOT, '..', 'web', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const a = args();
const SEND = !!a.send;
const LIMIT = Number(a.limit || 10);
const MIN_PRIORITY = Number(a['min-priority'] || 4);
const PRO_UNTIL = a.until || '2027-06-30T23:59:59Z';
const FROM = process.env.OUTREACH_FROM || 'Shivam Chopra <shivam@demist.app>';
const REPLY_TO = process.env.OUTREACH_REPLY_TO || 'shivam@demist.app';
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (SEND && !process.env.RESEND_API_KEY) { console.error('Missing RESEND_API_KEY in growth/.env'); process.exit(1); }

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
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

// leeds.ac.uk -> leeds, mailbox.lboro.ac.uk -> lboro, cs.stanford.edu -> stanford
function codeFor(domain) {
  const parts = domain.replace(/^www\./, '').split('.');
  const tail = /^(ac|co|edu|org|gov)$/.test(parts[parts.length - 2]) ? 2 : 1;
  return parts[parts.length - tail - 1].toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
}

const TOPIC_WORDS = {
  'lecture recording': 'lecture recording', 'recording lectures': 'lecture recording', 'record lectures': 'lecture recording',
  'assistive technology': 'assistive technology', 'assistive software': 'assistive software',
  'note-taking': 'note-taking support', 'notetaking': 'note-taking support', 'note taking': 'note-taking support',
  'note-taker': 'note-taking support', 'notetaker': 'note-taking support', 'live captions': 'live captions', 'lecture capture': 'lecture capture',
};

function emailFor(o, link) {
  const topic = (o.topic_seen || '').split('; ').map((t) => TOPIC_WORDS[t]).find(Boolean) || 'support for disabled students';
  const tools = (o.tools_named || '').split('; ').filter(Boolean).slice(0, 2);
  const toolLine = tools.length ? `, which mentions ${tools.join(' and ')}` : '';
  const uk = o.country === 'United Kingdom';
  const subject = uk ? 'Lecture support for your students, free from a charity' : 'A free lecture tool for students with accommodations';
  const text = `Hello ${o.university} team,

I'm Shivam Chopra from Graceful Minds, ${uk ? 'a charity' : 'a UK charity'} that supports neurodivergent young people. We make Demist, a lecture app for students who find lectures hard to follow: students with ADHD, dyslexia, hearing loss, or ${uk ? 'English as an additional language' : 'English as a second language'}.

I was reading your page on ${topic}${toolLine}. Demist does something slightly different. While the lecture is happening it shows a live transcript and explains difficult words in plain English as the lecturer says them. Afterwards it writes notes the student can ${uk ? 'revise' : 'study'} from. On Windows, the transcription runs on the student's own laptop, so the lecture audio is not uploaded anywhere.

We would like to give your students Demist Pro free until ${uk ? '30 June 2027' : 'June 30, 2027'}. There is nothing for you to buy or install: students open this link and sign up themselves.

${link}

If you find it useful, we would be grateful if you could add Demist to your list of ${uk ? 'tools for students' : 'assistive technology resources'}.

To be clear about its limits: it does not replace a human note-taker or captioner, and the automatic explanations can sometimes be wrong. The app says so too.

There is also a page you can pass on to teaching staff, with a short message they can post for their class: https://demist.app/for-lecturers

Would a one-page guide you could pass on to students be useful? I'm also happy to do a 15-minute call or a demo on a real lecture.

Best wishes,
Shivam Chopra
Graceful Minds
https://demist.app

If this isn't relevant to you, just reply "no" and we won't contact you again.
`;
  return { subject, text };
}

async function sb(pathname, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${pathname}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

async function main() {
  const offices = parseCsv(fs.readFileSync(path.join(OUT, 'offices-best.csv'), 'utf8'));
  // Inboxes checked by hand (domain,inbox) replace what the scan picked.
  const ovFile = path.join(OUT, 'inbox-overrides.csv');
  if (fs.existsSync(ovFile)) {
    const ov = new Map(parseCsv(fs.readFileSync(ovFile, 'utf8')).map((r) => [r.domain, r.inbox]));
    for (const o of offices) if (ov.has(o.domain)) { o.inbox = ov.get(o.domain); o.priority = String(Math.max(Number(o.priority), 4)); }
  }
  const sentFile = path.join(OUT, 'sent.csv');
  const dncFile = path.join(OUT, 'do-not-contact.txt');
  const sent = fs.existsSync(sentFile) ? parseCsv(fs.readFileSync(sentFile, 'utf8')) : [];
  const sentTo = new Set(sent.map((s) => s.to.toLowerCase()));
  const sentDomains = new Set(sent.map((s) => s.domain));
  const dnc = new Set(fs.existsSync(dncFile) ? fs.readFileSync(dncFile, 'utf8').split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean) : []);

  const used = new Set();
  const batch = offices
    // IT, web and mailing-list inboxes are not the disability office.
    .filter((o) => !/(digital|^web|websupport|techsupport|helpdesk|servicedesk|innovative|-l@|@ufic.)/i.test(o.inbox || ''))
    .filter((o) => (!a.country || o.country === a.country) && o.inbox && Number(o.priority) >= MIN_PRIORITY && !sentDomains.has(o.domain) && !sentTo.has(o.inbox.toLowerCase())
      && !dnc.has(o.inbox.toLowerCase()) && !dnc.has(o.domain))
    .slice(0, LIMIT)
    .map((o) => {
      let code = codeFor(o.domain);
      // Codes need 3+ characters (uni_offers check): hw.ac.uk -> heriot-watt-university
      if (code.length < 3) code = o.university.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      while (used.has(code)) code += '-u';
      used.add(code);
      return { ...o, code, link: `https://demist.app/uni/${code}` };
    });

  let md = `# Outbox ${today()} (${SEND ? 'SENT' : 'dry run'})\n\nFrom: ${FROM}\n\n`;
  for (const o of batch) {
    const { subject, text } = emailFor(o, o.link);
    md += `## ${o.university} -> ${o.inbox}\nSubject: ${subject}\n\n${text}\n---\n\n`;
    if (!SEND) continue;
    await sb('uni_offers?on_conflict=code', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ code: o.code, org_name: o.university, domain: o.domain, pro_until: PRO_UNTIL }),
    });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [o.inbox], reply_to: REPLY_TO, subject, text }),
    });
    const body = await res.text();
    const row = { date: new Date().toISOString(), domain: o.domain, university: o.university, to: o.inbox, code: o.code, status: res.ok ? 'sent' : `error ${res.status}`, id: res.ok ? JSON.parse(body).id : body.slice(0, 200) };
    fs.appendFileSync(sentFile, (fs.existsSync(sentFile) ? '' : 'date,domain,university,to,code,status,id\n') + toCsv([row], Object.keys(row)).split('\n')[1] + '\n');
    console.log(`${row.status}: ${o.university} -> ${o.inbox}`);
    await sleep(1500);
  }
  fs.mkdirSync(path.join(OUT, 'outbox'), { recursive: true });
  const file = path.join(OUT, 'outbox', `${today()}${SEND ? '-sent' : ''}.md`);
  fs.writeFileSync(file, md);
  console.log(`${batch.length} emails ${SEND ? 'processed' : 'drafted (dry run)'} -> ${file}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
