import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-[#110B1C] text-white flex flex-col items-center justify-center px-6 text-center gap-4">
      <p className="text-[48px] font-bold text-white/10">404</p>
      <h1 className="text-[22px] font-bold">Page not found</h1>
      <p className="text-gray-500 text-[15px]">This page doesn&apos;t exist or has been moved.</p>
      <Link href="/" className="mt-4 text-[14px] text-brand-700 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 transition-colors">
        ← Back to Demist
      </Link>
    </main>
  )
}
