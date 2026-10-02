// Seeds store-demo@demist.app, the account used for Microsoft Store / app
// store screenshots: a Year 2 Medicine student with three curated lectures.
//   cd web && node scripts/seed-store-demo.mjs
// Idempotent: wipes the demo user's sessions/terms and re-inserts them.
// profiles.is_internal = true keeps it out of analytics.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]))
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const EMAIL = 'store-demo@demist.app'
const DAY = 86400000
const now = Date.now()
const at = (daysAgo, hour, min = 0) => { const d = new Date(now - daysAgo * DAY); d.setHours(hour, min, 0, 0); return d.toISOString() }

// ── user ──
let { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
let user = list.users.find(u => u.email === EMAIL)
if (!user) {
  const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true, user_metadata: { purpose: 'Microsoft Store screenshots; safe to delete' } })
  if (error) throw error
  user = data.user
}
const uid = user.id
console.log('demo user', uid)

const { error: pErr } = await admin.from('profiles').upsert({
  id: uid, display_name: 'Maya', course: 'Medicine', year_of_study: 2, university: 'University of Birmingham',
  date_of_birth: '2005-03-14', ai_disclaimer_ack_at: new Date().toISOString(), support_need: 'attention',
  heard_from: 'other', heard_from_detail: 'store screenshots demo', web_trial_exempt: true, is_internal: true, is_public: false,
})
if (pErr) throw pErr

// ── clean slate ──
const { data: old } = await admin.from('sessions').select('id').eq('user_id', uid)
if (old?.length) {
  await admin.from('terms').delete().eq('user_id', uid)
  await admin.from('transcript_chunks').delete().in('session_id', old.map(s => s.id))
  await admin.from('sessions').delete().eq('user_id', uid)
}

const LECTURES = [
  {
    name: 'Cardiac conduction', subject: 'Medicine', started: at(0, 9, 5), mins: 52,
    synopsis: 'How the heartbeat starts in the SA node, is delayed at the AV node and spreads through the bundle of His and Purkinje fibres, and how that sequence produces the P wave, QRS complex and T wave on an ECG.',
    transcript: `Okay, let's get started. Today we're following a single heartbeat from start to finish. Every beat begins in the sinoatrial node, the SA node, a small cluster of pacemaker cells in the wall of the right atrium. These cells don't have a stable resting potential. Instead they slowly depolarise on their own, which we call the pacemaker potential, and that's driven largely by the funny current. When they reach threshold they fire, and the wave of depolarisation spreads across both atria. On the ECG, that's your P wave.

Now, the signal reaches the atrioventricular node, the AV node, and here something important happens: it slows down. That delay, roughly a tenth of a second, gives the atria time to finish emptying into the ventricles before the ventricles contract. If you remember one thing about the AV node, remember the delay.

From there the impulse travels down the bundle of His, splits into the left and right bundle branches, and finally reaches the Purkinje fibres, which conduct very quickly and spread the signal through the ventricular myocardium. That rapid ventricular depolarisation is the QRS complex. Repolarisation of the ventricles gives us the T wave.

Clinically, if the AV node stops conducting properly you get heart block, and in complete heart block the ventricles fall back on their own, much slower, escape rhythm. We'll come back to arrhythmias next week.`,
    terms: [
      ['SA node', 'The heart’s natural pacemaker: a cluster of cells in the right atrium that fire on their own and start every heartbeat.'],
      ['Pacemaker potential', 'The slow, automatic depolarisation of pacemaker cells between beats, which is why they fire without any outside signal.'],
      ['Funny current', 'An inward sodium current in pacemaker cells that is activated by hyperpolarisation and drives the pacemaker potential.'],
      ['AV node', 'Tissue between the atria and ventricles that briefly delays the electrical signal so the atria finish emptying before the ventricles contract.'],
      ['Bundle of His', 'A band of specialised fibres that carries the impulse from the AV node down into the septum between the ventricles.'],
      ['Purkinje fibres', 'Fast-conducting fibres that spread the impulse rapidly through the ventricle walls so they contract together.'],
      ['QRS complex', 'The sharp spike on an ECG produced by depolarisation of the ventricles.'],
      ['Heart block', 'A delay or failure of conduction through the AV node, so some or all atrial beats do not reach the ventricles.'],
      ['Escape rhythm', 'A slower backup rhythm generated lower in the conduction system when the normal pacemaker signal does not get through.'],
    ],
  },
  {
    name: 'Renal physiology: the nephron', subject: 'Medicine', started: at(2, 14, 0), mins: 48,
    synopsis: 'How the nephron filters blood at the glomerulus, reabsorbs most of it in the proximal tubule, and uses the loop of Henle and ADH to control how concentrated the urine is.',
    transcript: `Each kidney has about a million nephrons, and each one does the same three jobs: filtration, reabsorption and secretion. Filtration happens at the glomerulus, a knot of capillaries sitting inside Bowman's capsule. The rate at which plasma is filtered here, the glomerular filtration rate or GFR, is the number you'll see on almost every blood test that asks how well the kidneys are working.

The proximal convoluted tubule then reabsorbs the bulk of what was filtered: around two thirds of the sodium and water, and essentially all of the glucose. Next comes the loop of Henle, which sets up a concentration gradient in the medulla through countercurrent multiplication. That gradient is what later lets us make concentrated urine.

The final say belongs to the collecting duct, under the control of antidiuretic hormone. When you're dehydrated, ADH inserts aquaporins into the collecting duct and water follows the gradient back into the body.`,
    terms: [
      ['Glomerulus', 'A tangle of capillaries at the start of each nephron where blood plasma is filtered into the kidney tubule.'],
      ['GFR', 'Glomerular filtration rate: how much plasma the kidneys filter per minute, the standard measure of kidney function.'],
      ['Proximal convoluted tubule', 'The first section of the tubule, which reabsorbs most of the filtered water, sodium and all of the glucose.'],
      ['Loop of Henle', 'A hairpin section of the nephron that builds a salt gradient in the kidney’s inner layer so urine can be concentrated.'],
      ['Countercurrent multiplication', 'The mechanism by which flow in opposite directions through the loop of Henle builds up a steep salt gradient.'],
      ['ADH', 'Antidiuretic hormone: released when the body needs to hold on to water, it makes the collecting duct reabsorb more water.'],
      ['Aquaporins', 'Water channels in cell membranes; ADH adds them to the collecting duct so water can be reabsorbed.'],
    ],
  },
  {
    name: 'Pharmacology: beta blockers', subject: 'Medicine', started: at(4, 11, 0), mins: 45,
    synopsis: 'How beta blockers act on beta-1 and beta-2 adrenoceptors, why cardioselective drugs are preferred, and the side effects and contraindications to know.',
    transcript: `Beta blockers are competitive antagonists at beta adrenoceptors. Beta-1 receptors are mainly in the heart, beta-2 mainly in the lungs and blood vessels. Blocking beta-1 lowers heart rate and contractility, which is why we use them in angina, heart failure and for rate control in atrial fibrillation.

Drugs like bisoprolol are cardioselective, meaning they prefer beta-1. That matters because blocking beta-2 in the airways can cause bronchospasm, so non-selective beta blockers are avoided in asthma. Other side effects to know are bradycardia, cold peripheries and fatigue.`,
    terms: [
      ['Competitive antagonist', 'A drug that binds the same receptor as the body’s own signal and blocks it, without activating the receptor itself.'],
      ['Beta-1 adrenoceptor', 'A receptor mainly found in the heart; stimulating it raises heart rate and the force of contraction.'],
      ['Cardioselective', 'Describes a beta blocker that acts mainly on beta-1 receptors in the heart rather than beta-2 receptors in the lungs.'],
      ['Bronchospasm', 'Sudden tightening of the muscles around the airways, making it hard to breathe.'],
      ['Bradycardia', 'A slower than normal heart rate, usually under 60 beats per minute in adults.'],
    ],
  },
]

for (const [li, L] of LECTURES.entries()) {
  const ended = new Date(new Date(L.started).getTime() + L.mins * 60000).toISOString()
  const { data: s, error } = await admin.from('sessions').insert({
    user_id: uid, name: L.name, ai_name: L.name, subject: L.subject, year_of_study: 2,
    started_at: L.started, ended_at: ended, synopsis: L.synopsis, transcript: L.transcript,
    source: 'live', capture_mode: 'microphone',
  }).select('id').single()
  if (error) throw error
  const paras = L.transcript.split(/\n\n/)
  await admin.from('transcript_chunks').insert(paras.map((text, i) => ({ session_id: s.id, chunk_index: i, text, created_at: L.started })))
  const rows = L.terms.map(([term, definition], i) => {
    // Today's lecture: brand new cards. Older lectures: a mix of due and learned.
    const reviewed = li > 0 && i % 3 !== 2
    return {
      user_id: uid, session_id: s.id, term, definition, subject: L.subject, times_seen: 1 + (i % 3),
      created_at: new Date(new Date(L.started).getTime() + (i + 1) * 4 * 60000).toISOString(),
      context: (L.transcript.split(/(?<=[.!?])\s+/).find(x => x.toLowerCase().includes(term.toLowerCase().split(' ')[0])) ?? null),
      sm2_review_count: reviewed ? 2 : 0, sm2_interval: reviewed ? (i % 2 ? 6 : 1) : 0, sm2_ease: 2.5,
      sm2_due_at: reviewed ? new Date(now + (i % 2 ? 4 : -1) * DAY).toISOString() : null,
      known: false, dismissed: false,
    }
  })
  const { error: tErr } = await admin.from('terms').insert(rows)
  if (tErr) throw tErr
  console.log('seeded', L.name, rows.length, 'terms')
}
