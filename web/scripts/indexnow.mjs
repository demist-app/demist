// Tells Bing (and every other IndexNow engine) about every public URL, after
// each PRODUCTION build. Run as npm's postbuild.
//
// WHY. ChatGPT's web search leans on Bing's index, and Bing had never been
// told about demist.app beyond finding it on its own. IndexNow gets new and
// changed pages (a new /for or /compare page, a corrected claim) crawled in
// hours instead of weeks.
//
// Never fails the build: a deploy must not depend on a third party being up.
// But it is never silent either. A non-2xx response is logged to the build
// output AND sent to PostHog as an exception, so it lands in the error digest.

import fs from 'node:fs'
import path from 'node:path'

const HOST = 'www.demist.app'
const key = process.env.INDEXNOW_KEY
const env = process.env.VERCEL_ENV

async function report(message, props = {}) {
  console.error(`[indexnow] ${message}`, props)
  const phKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!phKey) return
  try {
    await fetch('https://eu.i.posthog.com/capture/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: phKey,
        event: '$exception',
        distinct_id: 'indexnow-postbuild',
        properties: {
          $exception_list: [{ type: 'IndexNowError', value: message }],
          $exception_message: message,
          source: 'indexnow',
          ...props,
        },
      }),
    })
  } catch { /* nothing more to do */ }
}

async function main() {
  if (env !== 'production') { console.log(`[indexnow] skipped: VERCEL_ENV=${env ?? 'unset'}`); return }
  if (!key) { await report('INDEXNOW_KEY is not set, nothing submitted'); return }

  // The sitemap Next just generated for THIS build, so pages added in this
  // deploy are included. Falls back to the live one if the build output moved.
  let xml = null
  const built = path.join(process.cwd(), '.next', 'server', 'app', 'sitemap.xml.body')
  if (fs.existsSync(built)) xml = fs.readFileSync(built, 'utf8')
  else {
    try { xml = await (await fetch(`https://${HOST}/sitemap.xml`)).text() } catch { /* handled below */ }
  }
  const urls = [...(xml ?? '').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim())
    .filter(u => new URL(u).host === HOST)
  if (!urls.length) { await report('no sitemap URLs found for this host, nothing submitted', { had_xml: !!xml }); return }

  let res
  try {
    res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/indexnow-key.txt`, urlList: urls }),
    })
  } catch (e) {
    await report(`network error: ${e.message}`, { urls: urls.length })
    return
  }
  // 200 and 202 both mean accepted (202: key validation still pending).
  if (res.status === 200 || res.status === 202) {
    console.log(`[indexnow] submitted ${urls.length} URLs: HTTP ${res.status}`)
  } else {
    const body = await res.text().catch(() => '')
    await report(`HTTP ${res.status}`, { urls: urls.length, body: body.slice(0, 300) })
  }
}

main().catch(e => report(`crashed: ${e.message}`))
