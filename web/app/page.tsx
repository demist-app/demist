'use client'

import posthog from 'posthog-js'

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-black text-white p-8">
      <h1 className="text-5xl font-bold mb-4">Demist</h1>
      <p className="text-xl text-gray-400 mb-8">Never feel lost in a lecture again.</p>
      <div className="flex gap-4">
        <a
          href="/login"
          className="bg-white text-black px-6 py-3 rounded-lg font-medium"
          onClick={() => posthog.capture('get_started_clicked')}
        >
          Get started
        </a>
      </div>
    </main>
  )
}
