import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-[#080810] text-white flex flex-col items-center justify-center px-6 text-center gap-4">
      <p className="text-[48px] font-bold text-white/10">404</p>
      <h1 className="text-[22px] font-bold">Page not found</h1>
      <p className="text-gray-500 text-[15px]">This page doesn&apos;t exist or has been moved.</p>
      <Link href="/" className="mt-4 text-[14px] text-violet-400 hover:text-violet-300 transition-colors">
        ← Back to Demist
      </Link>
    </main>
  )
}
