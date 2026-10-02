import type { Metadata } from 'next'
import { AboutClient } from './about-client'

export const metadata: Metadata = {
  title: 'About Demist',
  description: 'Demist by Graceful Minds helps students who struggle to listen and take notes at the same time. Real-time term explanations, automatic notes, and flashcards from every lecture.',
  alternates: { canonical: 'https://www.demist.app/about' },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'About Demist',
  url: 'https://www.demist.app/about',
  about: { '@type': 'Thing', name: 'Lecture accessibility for university students' },
  audience: { '@type': 'EducationalAudience', educationalRole: 'student' },
  publisher: { '@type': 'Organization', name: 'Graceful Minds', url: 'https://www.graceful-minds.org' },
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
