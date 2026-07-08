import type { Metadata } from 'next'
import { AccessibilityClient } from './accessibility-client'

export const metadata: Metadata = {
  title: 'Demist for DSA & Accessibility',
  description: 'Demist helps students who struggle to listen and take notes at the same time. Real-time term explanations, automatic notes, and flashcards from every lecture.',
  alternates: { canonical: 'https://demist.app/accessibility' },
}

export default function AccessibilityPage() {
  return <AccessibilityClient />
}
