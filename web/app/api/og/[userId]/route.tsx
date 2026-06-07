import { ImageResponse } from 'next/og'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data } = await supabase.rpc('get_public_profile_stats', { target_user_id: userId })
  const profile = data?.[0] as {
    display_name: string | null
    course: string | null
    total_terms: number
    terms_this_week: number
  } | undefined

  const name = profile?.display_name || 'A Demist user'
  const initials = name.slice(0, 1).toUpperCase()
  const termsWeek = profile?.terms_this_week ?? 0
  const termsTotal = profile?.total_terms ?? 0
  const course = profile?.course ?? ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px', height: '630px', background: '#080810',
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
          justifyContent: 'center', padding: '80px', fontFamily: 'sans-serif',
          position: 'relative', overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: '-200px', right: '-200px', width: '600px', height: '600px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(251,191,36,0.20) 0%, transparent 70%)' }} />
        <div style={{ display: 'flex', marginBottom: '48px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.2em', color: 'rgba(251,191,36,0.75)', textTransform: 'uppercase' }}>Demist</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '48px' }}>
          <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(251,191,36,0.15)', border: '2px solid rgba(251,191,36,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: 700, color: '#FBBF24' }}>
            {initials}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '36px', fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>{name}</span>
            {course ? <span style={{ fontSize: '18px', color: '#6b7280', marginTop: '4px' }}>{course}</span> : null}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '48px' }}>
          <span style={{ fontSize: '56px', fontWeight: 800, color: '#fff', lineHeight: 1 }}>{termsWeek} new terms</span>
          <span style={{ fontSize: '28px', color: '#6b7280' }}>learned this week with Demist</span>
        </div>
        <div style={{ display: 'flex', background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.22)', borderRadius: '100px', padding: '10px 20px' }}>
          <span style={{ fontSize: '16px', color: '#FBBF24', fontWeight: 600 }}>{termsTotal} total terms learned</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}