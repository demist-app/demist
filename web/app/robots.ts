// Strategy: Demist WANTS to be found and cited by AI answer engines, so search
// and retrieval crawlers are explicitly allowed. Training crawlers are also
// allowed on purpose: for a startup whose problem is "no model knows we exist",
// being in training corpora helps brand recall inside LLMs. Revisit that choice
// if content licensing ever becomes a revenue line. App-private routes are
// disallowed for everyone; they're auth-gated anyway and only waste crawl budget.

import type { MetadataRoute } from 'next'

const PRIVATE = ['/dashboard', '/history', '/glossary', '/flashcards', '/study', '/profile', '/onboarding', '/api/']

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE },
      // Answer-engine and retrieval bots, listed explicitly so intent is unambiguous
      { userAgent: 'OAI-SearchBot', allow: '/', disallow: PRIVATE },
      { userAgent: 'ChatGPT-User', allow: '/', disallow: PRIVATE },
      { userAgent: 'GPTBot', allow: '/', disallow: PRIVATE },
      { userAgent: 'Claude-SearchBot', allow: '/', disallow: PRIVATE },
      { userAgent: 'Claude-User', allow: '/', disallow: PRIVATE },
      { userAgent: 'ClaudeBot', allow: '/', disallow: PRIVATE },
      { userAgent: 'PerplexityBot', allow: '/', disallow: PRIVATE },
      { userAgent: 'Google-Extended', allow: '/', disallow: PRIVATE },
      { userAgent: 'Bingbot', allow: '/', disallow: PRIVATE },
    ],
    sitemap: 'https://demist.app/sitemap.xml',
  }
}
