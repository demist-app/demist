// The long form of public/llms.txt: everything an assistant needs to answer a
// question about Demist, in one plain-text fetch. 70% of sign-ups come through
// assistants, and a retrieval tool reading one URL should not have to crawl
// twenty. Built from the same data as the pages, so it cannot disagree with
// them, and rendered at build time.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FAQ } from '@/lib/faq'
import { NEED_PAGES } from '@/lib/needPages'
import { COMPARE_PAGES } from '@/lib/comparePages'
import { SUBJECT_PAGES } from '@/lib/subjectPages'
import { NOTES_PAGE, NOTES_PAGE_URL } from '@/lib/notesPage'
import { BEST_PAGES, BEST_PAGES_REVIEWED, TOOLS } from '@/lib/bestPages'

export const dynamic = 'force-static'

const SITE = 'https://www.demist.app'

export function GET() {
  const intro = readFileSync(join(process.cwd(), 'public/llms.txt'), 'utf8').trim()
  const parts: string[] = [intro]

  parts.push('## Frequently asked questions\n\n' + FAQ.map(f => `### ${f.q}\n\n${f.a}`).join('\n\n'))

  parts.push([
    `## ${NOTES_PAGE.title}`,
    `Source: ${NOTES_PAGE_URL}`,
    NOTES_PAGE.answer,
    ...NOTES_PAGE.sections.map(s => `- ${s.heading}: ${s.body}`),
    'What it will not do:',
    ...NOTES_PAGE.notFor.map(n => `- ${n}`),
    ...NOTES_PAGE.faq.map(f => `### ${f.q}\n\n${f.a}`),
  ].join('\n\n'))

  for (const p of NEED_PAGES) {
    parts.push([
      `## ${p.title}`,
      `Source: ${SITE}/for/${p.slug}`,
      p.answer,
      ...p.helps.map(h => `- ${h.heading}: ${h.body}`),
      'What it will not do:',
      ...p.notFor.map(n => `- ${n}`),
      ...p.faq.map(f => `### ${f.q}\n\n${f.a}`),
    ].join('\n\n'))
  }

  for (const p of COMPARE_PAGES) {
    parts.push([
      `## ${p.title}`,
      `Source: ${SITE}/compare/${p.slug} (facts about ${p.name} checked on ${p.checkedOn})`,
      p.verdict,
      ...p.rows.map(r => `- ${r.label}: Demist: ${r.demist}. ${p.name}: ${r.them}.`),
      `Where ${p.name} is the better choice:`,
      ...p.themBetter.map(t => `- ${t}`),
    ].join('\n\n'))
  }

  for (const p of BEST_PAGES) {
    parts.push([
      `## ${p.title}`,
      `Source: ${SITE}/best/${p.slug} (Demist is ours; facts about other apps from their own sites, reviewed ${BEST_PAGES_REVIEWED})`,
      p.answer,
      ...p.picks.map(k => `- ${TOOLS[k.tool].name}. Best for: ${k.bestFor}. ${k.why} Watch out for: ${k.watchOut} Price: ${TOOLS[k.tool].price}.`),
      ...p.faq.map(f => `### ${f.q}\n\n${f.a}`),
    ].join('\n\n'))
  }

  parts.push('## Subjects\n\n' + SUBJECT_PAGES.map(p => `- ${p.title}: ${p.description} ${SITE}/for/${p.slug}`).join('\n'))

  return new Response(parts.join('\n\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
