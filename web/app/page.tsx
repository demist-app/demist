import type { Metadata } from 'next'
import LandingClient from './landing-client'

export const metadata: Metadata = {
  title: 'Demist: Never Feel Lost in a Lecture Again',
  description: 'Demist listens to your lectures and quietly flags unfamiliar terms in real time. Build a personal glossary and review with spaced repetition flashcards.',
  alternates: { canonical: 'https://demist.app' },
  openGraph: {
    title: 'Demist: Never Feel Lost in a Lecture Again',
    description: 'Demist listens to your lectures and quietly flags unfamiliar terms in real time. Built for university students.',
    url: 'https://demist.app',
    type: 'website',
    images: [
      {
        url: 'https://demist.app/icon.png',
        width: 512,
        height: 512,
        alt: 'Demist: real-time lecture term detection',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Demist: Never Feel Lost in a Lecture Again',
    description: 'Demist listens to your lectures and quietly flags unfamiliar terms in real time.',
    images: ['https://demist.app/icon.png'],
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Demist',
  applicationCategory: 'EducationApplication',
  operatingSystem: 'Web',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' },
  description: 'Demist listens to university lectures and surfaces real-time definitions for unfamiliar terms. Builds a personal glossary and uses spaced repetition flashcards for review.',
  url: 'https://demist.app',
  audience: { '@type': 'EducationalAudience', educationalRole: 'student' },
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingClient />
    </>
  )
}
