'use client'

// Aligned sentence pairs, source stacked directly above its translation, both
// at full container width (not two half-width side-by-side columns): a
// desktop two-column layout meant every sentence wrapped far more than it
// does in the English-only/translated-only views (each column only gets half
// the width), so the same content took noticeably more vertical space and
// scrolling in "Both" mode than switching to a single-language tab. Stacking
// at full width matches the wrapping (and scroll amount) of those tabs while
// still pairing each sentence with its translation immediately below it.
//
// Beyond wrapping, this deliberately reuses the exact presentation the
// single-language views get, because it previously did not and read as a
// different component bolted into the same panel. Specifically:
//   - data-age drives the fade ladder in globals.css
//     (.transcript-container [data-age="0..5"]), so the newest lines are
//     opaque and semibold and older ones recede. "Both" had no data-age at
//     all, so every line sat at full opacity: a flat wall of text with no
//     sense of where "live" was, next to two sibling tabs that both fade.
//   - the same type scale, leading and transition as those views.
// The age is applied to the pair wrapper rather than to each line, so a
// sentence and its translation always fade together as one unit.
//
// Arabic gets dir="rtl". A pair with tgt === null is still being translated
// and renders a subtle pending marker; tgt === '' means translation failed
// for that sentence and renders the source alone, with no empty second line
// leaving a phantom gap in the fade ladder.

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
    <>
      {pairs.map((p, i) => (
        // Matches the single-language views' `Math.min(length - 1 - i, 5)`:
        // the fade ladder in globals.css only defines ages 0 through 5.
        <div
          key={i}
          data-age={Math.min(pairs.length - 1 - i, 5)}
          className="mb-2 transition-opacity duration-500"
        >
          <p
            className="text-[calc(0.875rem*var(--df-scale))] leading-relaxed"
            onPointerUp={onSourceClick}
            dangerouslySetInnerHTML={{ __html: p.srcHtml }}
          />
          {p.tgt !== '' && (
            <p
              dir={rtl ? 'rtl' : undefined}
              className="text-[calc(0.875rem*var(--df-scale))] leading-relaxed dark:text-amber-300/80 text-amber-700"
            >
              {p.tgt === null ? <span className="dark:text-white/25 text-gray-400">⋯</span> : p.tgt}
            </p>
          )}
        </div>
      ))}
    </>
  )
}
