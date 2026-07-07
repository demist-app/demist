import type { Metadata } from 'next'
import LandingClient from './landing-client'

export const metadata: Metadata = {
  title: 'Demist: Never Feel Lost in a Lecture Again',
  description: 'Demist transcribes lectures, reads them back, and explains and translates unfamiliar terms in real time — for students who find lectures harder to follow.',
  alternates: { canonical: 'https://demist.app' },
  openGraph: {
    title: 'Demist: Never Feel Lost in a Lecture Again',
    description: 'Transcribes lectures, reads them back, and explains and translates unfamiliar terms in real time. Built for university students.',
    url: 'https://demist.app',
    type: 'website',
    images: [
      {
        url: 'https://demist.app/og',
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
    images: ['https://demist.app/og'],
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Demist',
  applicationCategory: 'EducationApplication',
  operatingSystem: 'Web',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' },
  description: 'Demist transcribes lectures, reads them back, and explains and translates unfamiliar terms in real time, for students who find lectures harder to follow. Builds a personal glossary and uses spaced repetition flashcards for review.',
  url: 'https://demist.app',
  audience: { '@type': 'EducationalAudience', educationalRole: 'student' },
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
