import type { Metadata } from 'next'
import { AboutClient } from './about-client'

export const metadata: Metadata = {
  title: 'About Demist',
  description: 'Demist helps students who struggle to listen and take notes at the same time. Real-time term explanations, automatic notes, and flashcards from every lecture.',
  alternates: { canonical: 'https://demist.app/about' },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'About Demist',
  url: 'https://demist.app/about',
  about: { '@type': 'Thing', name: "Disabled Students' Allowance" },
  audience: { '@type': 'EducationalAudience', educationalRole: 'student' },
}

export default function AboutPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <AboutClient />
    </>
  )
}
