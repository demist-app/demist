import type { Metadata } from 'next'
import { PRO_PRICE_GBP } from '@/lib/pricing'
import LandingClient from './landing-client'
import { FAQ } from '@/lib/faq'

export const metadata: Metadata = {
  title: 'Demist: Never Feel Lost in a Lecture Again',
  description: 'Demist transcribes lectures, reads them back, and explains and translates unfamiliar terms in real time, for students who find lectures harder to follow.',
  alternates: { canonical: 'https://www.demist.app' },
  openGraph: {
    title: 'Demist: Never Feel Lost in a Lecture Again',
    description: 'Transcribes lectures, reads them back, and explains and translates unfamiliar terms in real time. Built for university students.',
    url: 'https://www.demist.app',
    type: 'website',
    images: [
      {
        url: 'https://www.demist.app/og',
        width: 1200,
        height: 630,
        alt: 'Demist: real-time lecture term detection',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Demist: Never Feel Lost in a Lecture Again',
    description: 'Demist transcribes lectures, reads them back, and explains and translates unfamiliar terms in real time.',
    images: ['https://www.demist.app/og'],
  },
}

// A bare top-level ARRAY of nodes here (the previous shape) is technically
// valid JSON-LD as long as each node carries its own @context, but it isn't
// what most structured-data consumers expect from a single script tag - and
// it isn't hypothetical: real Mac Safari and iOS Safari visitors were hitting
// a live TypeError, "undefined is not an object (evaluating
// 'r["@context"].toLowerCase')", confirmed in PostHog's exception events on
// this exact page (Sept 2026). Something in WebKit's own structured-data
// scanner reads the script's top-level value as a single node and indexes
// r["@context"] straight off it - on an array that's undefined, and calling
// .toLowerCase() on undefined throws. Chrome never hits this, which is why
// it went unnoticed. The single-object-with-@graph shape below is the
// standard way to carry multiple JSON-LD nodes in one script tag (schema.org
// documents this pattern directly for exactly this reason) and fixes it: the
// top-level value is now one object, so r["@context"] resolves to the string
// "https://schema.org" every time, on every consumer.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Demist',
      url: 'https://www.demist.app',
      logo: 'https://www.demist.app/icon.svg',
      email: 'hello@demist.app',
      sameAs: [
        // fill with real profile URLs as they exist: Instagram, TikTok, LinkedIn, X
      ],
    },
    {
      '@type': 'WebSite',
      name: 'Demist',
      url: 'https://www.demist.app',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Demist',
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Windows, Web',
      // Prices from lib/pricing.ts, the same constant the FAQ quotes, so the
      // structured data cannot drift from the copy. No aggregateRating or
      // review: there are no real reviews to mark up.
      offers: [
        { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'GBP' },
        { '@type': 'Offer', name: 'Demist Pro, monthly', price: PRO_PRICE_GBP.monthly.toFixed(2), priceCurrency: 'GBP' },
        { '@type': 'Offer', name: 'Demist Pro, yearly', price: PRO_PRICE_GBP.yearly.toFixed(2), priceCurrency: 'GBP' },
      ],
      description: 'Demist transcribes lectures, reads them back, and explains and translates unfamiliar terms in real time, for students who find lectures harder to follow. Builds a personal glossary and uses spaced repetition flashcards for review.',
      url: 'https://www.demist.app',
      audience: { '@type': 'EducationalAudience', educationalRole: 'student' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQ.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <LandingClient />
    </>
  )
}
