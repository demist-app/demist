'use client'

import { useRef, useState } from 'react'
import { capture } from '@/lib/analytics'

interface Props {
  termCount: number
  featuredTerm?: { term: string; definition: string } | null
  onClose: () => void
}

const W = 1080
const H = 1920

// Canvas text doesn't wrap on its own, and unlike the old hardcoded example
// string, a real term/definition can be any length. Greedy word-wrap, with
// an ellipsis on the last allowed line if it still doesn't fit - the same
// tradeoff line-clamping in the DOM elsewhere in this app makes.
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line)
      line = word
      if (lines.length === maxLines) { line = ''; break }
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) lines.length = maxLines
  const last = lines[lines.length - 1]
  if (last && ctx.measureText(last).width > maxWidth) {
    while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) {
      lines[lines.length - 1] = last.slice(0, -1)
    }
    lines[lines.length - 1] += '…'
  }
  return lines
}

function drawCard(canvas: HTMLCanvasElement, termCount: number, featuredTerm?: { term: string; definition: string } | null) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = W
  canvas.height = H

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0a0a14')
  bg.addColorStop(1, '#080810')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Amber glow top-left
  const glow1 = ctx.createRadialGradient(200, 400, 0, 200, 400, 700)
  glow1.addColorStop(0, 'rgba(161,98,7,0.18)')
  glow1.addColorStop(1, 'transparent')
  ctx.fillStyle = glow1
  ctx.fillRect(0, 0, W, H)

  // Amber glow bottom-right
  const glow2 = ctx.createRadialGradient(W - 200, H - 600, 0, W - 200, H - 600, 600)
  glow2.addColorStop(0, 'rgba(234,179,8,0.10)')
  glow2.addColorStop(1, 'transparent')
  ctx.fillStyle = glow2
  ctx.fillRect(0, 0, W, H)

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, W - 2, H - 2)

  // Wordmark
  ctx.font = 'bold 52px -apple-system, system-ui, sans-serif'
  ctx.letterSpacing = '0.2em'
  ctx.fillStyle = '#d97706'
  ctx.fillText('DEMIST', 88, 140)
  ctx.letterSpacing = '0px'

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(88, 172)
  ctx.lineTo(W - 88, 172)
  ctx.stroke()

  // Big number
  ctx.font = `bold 280px -apple-system, system-ui, sans-serif`
  ctx.fillStyle = '#eab308'
  ctx.textAlign = 'center'
  ctx.fillText(String(termCount), W / 2, H / 2 - 80)

  // Label under number
  ctx.font = `500 72px -apple-system, system-ui, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillText(termCount === 1 ? 'concept learned' : 'concepts learned', W / 2, H / 2 + 40)

  // Sub label
  ctx.font = `400 44px -apple-system, system-ui, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.fillText('from your lectures', W / 2, H / 2 + 116)

  // Term card preview - only drawn when there's a real term to show. The
  // card exists to make the share believable as THIS person's work, so a
  // placeholder here would be worse than no card at all.
  if (!featuredTerm) return
  const cardX = 88
  const cardY = H / 2 + 260
  const cardW = W - 176
  // Tall enough for a 2-line definition (the old fixed height only ever had
  // to fit one hardcoded sentence) plus breathing room below it.
  const cardH = 330
  const r = 40

  ctx.beginPath()
  ctx.moveTo(cardX + r, cardY)
  ctx.lineTo(cardX + cardW - r, cardY)
  ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + r)
  ctx.lineTo(cardX + cardW, cardY + cardH - r)
  ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - r, cardY + cardH)
  ctx.lineTo(cardX + r, cardY + cardH)
  ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - r)
  ctx.lineTo(cardX, cardY + r)
  ctx.quadraticCurveTo(cardX, cardY, cardX + r, cardY)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(234,179,8,0.25)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Card accent bar
  ctx.fillStyle = '#d97706'
  ctx.beginPath()
  ctx.roundRect(cardX + 44, cardY + 52, 8, cardH - 104, 4)
  ctx.fill()

  // Card label. This card is opened from the glossary's lifetime total, not
  // a single fresh detection, so "JUST DETECTED" was claiming something the
  // moment it's shown doesn't back up.
  ctx.font = 'bold 28px -apple-system, system-ui, sans-serif'
  ctx.letterSpacing = '0.18em'
  ctx.fillStyle = 'rgba(217,119,6,0.7)'
  ctx.textAlign = 'left'
  ctx.fillText('RECENTLY LEARNED', cardX + 80, cardY + 100)
  ctx.letterSpacing = '0px'

  // Card term - wrapped, not clipped, since a real term can run longer than
  // the two-word placeholder this replaced.
  ctx.font = 'bold 52px -apple-system, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  const termLines = wrapText(ctx, featuredTerm.term, cardW - 160, 1)
  ctx.fillText(termLines[0], cardX + 80, cardY + 165)

  // Card definition
  ctx.font = '400 38px -apple-system, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  const defLines = wrapText(ctx, featuredTerm.definition, cardW - 160, 2)
  defLines.forEach((line, i) => ctx.fillText(line, cardX + 80, cardY + 218 + i * 48))

  // CTA
  ctx.textAlign = 'center'
  ctx.font = '500 44px -apple-system, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.30)'
  ctx.fillText('demist.app', W / 2, H - 140)
}

export function ShareCard({ termCount, featuredTerm, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)
  const [sharing, setSharing] = useState(false)

  const render = () => {
    if (!canvasRef.current) return
    drawCard(canvasRef.current, termCount, featuredTerm)
    setRendered(true)
  }

  const share = async () => {
    if (!canvasRef.current) return
    setSharing(true)
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvasRef.current!.toBlob(b => b ? resolve(b) : reject(new Error('canvas toBlob failed')), 'image/png')
      )
      const file = new File([blob], 'demist-stats.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `I've learned ${termCount} concepts with Demist`, url: 'https://demist.app' })
        capture('share_card_shared', { termCount, method: 'native' })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = 'demist-stats.png'; a.click()
        URL.revokeObjectURL(url)
        capture('share_card_shared', { termCount, method: 'download' })
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') console.error('share failed', e)
    } finally {
      setSharing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:px-4 bg-black/40"
      style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm dark:bg-[#0f0f17] bg-[#FDFCF9] border dark:border-white/[0.08] border-black/[0.10] rounded-t-[24px] sm:rounded-[24px] shadow-2xl px-6 py-7 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
        <div className="flex items-center justify-between mb-5">
          <p className="text-[16px] font-bold dark:text-white text-gray-900">Share your stats</p>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 flex items-center justify-center dark:text-white/30 text-gray-400 dark:hover:text-white/60 hover:text-gray-600 transition-colors text-[20px] leading-none">×</button>
        </div>

        {/* Preview */}
        <div className="relative rounded-2xl overflow-hidden mb-5 aspect-[9/16] dark:bg-[#080810] bg-gray-900 flex items-center justify-center">
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain"
            style={{ display: rendered ? 'block' : 'none' }}
          />
          {!rendered && (
            <button
              onClick={render}
              className="flex flex-col items-center gap-2 text-center"
            >
              <div className="w-12 h-12 rounded-2xl dark:bg-white/[0.06] bg-white/10 flex items-center justify-center mb-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(234,179,8,0.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <p className="text-[13px] text-white/60">Tap to preview</p>
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={share}
            disabled={sharing}
            className="w-full py-3.5 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150 disabled:opacity-60"
          >
            {sharing ? 'Sharing…' : typeof navigator !== 'undefined' && 'share' in navigator ? 'Share image' : 'Download image'}
          </button>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-2xl dark:bg-white/[0.04] bg-[#F3F1EC] border dark:border-white/[0.07] border-black/[0.12] text-[14px] font-medium dark:text-gray-300 text-gray-700 active:scale-[0.97] transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
