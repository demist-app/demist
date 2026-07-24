'use client'

// Aligned sentence pairs, source stacked directly above its translation, both
// at full container width (not two half-width side-by-side columns): a
// desktop two-column layout meant every sentence wrapped far more than it
// does in the English-only/translated-only views (each column only gets half
// the width), so the same content took noticeably more vertical space and
// scrolling in "Both" mode than switching to a single-language tab. Stacking
// at full width matches the wrapping (and scroll amount) of those tabs while
// still pairing each sentence with its translation immediately below it.
// Arabic gets dir="rtl". A pair with tgt === null renders the source with a
// subtle pending marker; tgt === '' (failed) renders source only.

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
        <div key={i} className="space-y-0.5">
          <p
            className="text-[calc(0.875rem*var(--df-scale))] leading-relaxed"
            onPointerUp={onSourceClick}
            dangerouslySetInnerHTML={{ __html: p.srcHtml }}
          />
          <p
            dir={rtl ? 'rtl' : undefined}
            className="text-[calc(0.875rem*var(--df-scale))] leading-relaxed dark:text-amber-300/80 text-amber-700"
          >
            {p.tgt === null ? <span className="dark:text-white/25 text-gray-400">⋯</span> : p.tgt}
          </p>
        </div>
      ))}
    </div>
  )
}
