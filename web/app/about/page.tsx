import type { Metadata } from 'next'
import { AboutClient } from './about-client'

export const metadata: Metadata = {
  title: 'About Demist',
  description: 'Demist helps students who struggle to listen and take notes at the same time. Real-time term explanations, automatic notes, and flashcards from every lecture.',
  alternates: { canonical: 'https://demist.app/about' },
}

export default function AboutPage() {
  return <AboutClient />
}
