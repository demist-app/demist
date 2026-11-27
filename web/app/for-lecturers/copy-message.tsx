'use client'

import { useState } from 'react'
import { capture } from '@/lib/analytics'

export function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
      capture('lecturer_message_copied')
    } catch { /* clipboard blocked: the text is selectable below */ }
  }
  return (
    <div>
      <p className="text-[15px] leading-relaxed p-4 rounded-xl dark:bg-black/30 bg-[#F8F6FB] border dark:border-white/[0.08] border-black/[0.08] select-all">{text}</p>
      <button onClick={copy} className="mt-3 px-5 py-2.5 rounded-2xl bg-brand-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97]">
        {copied ? 'Copied' : 'Copy message'}
      </button>
    </div>
  )
}
