'use client'

// Aligned sentence pairs. Two columns on desktop, stacked per sentence on
// mobile. Arabic gets dir="rtl". A pair with tgt === null renders the source
// with a subtle pending marker; tgt === '' (failed) renders source only.

export interface SentencePair {
  srcHtml: string
  tgt: string | null
}

export function TranscriptBilingual({
  pairs,
  lang,
  onSourceClick,
}: {
  pairs: SentencePair[]
  lang: string
  onSourceClick?: (e: React.PointerEvent<HTMLParagraphElement>) => void
}) {
  const rtl = lang === 'ar'
  return (
    <div className="space-y-2.5">
      {pairs.map((p, i) => (
        <div key={i} className="grid grid-cols-1 md:grid-cols-2 gap-1 md:gap-4">
          <p
            className="text-sm leading-relaxed"
            onPointerUp={onSourceClick}
            dangerouslySetInnerHTML={{ __html: p.srcHtml }}
          />
          <p
            dir={rtl ? 'rtl' : undefined}
            className="text-sm leading-relaxed dark:text-amber-300/80 text-amber-700"
          >
            {p.tgt === null ? <span className="dark:text-white/25 text-gray-400">⋯</span> : p.tgt}
          </p>
        </div>
      ))}
    </div>
  )
}
