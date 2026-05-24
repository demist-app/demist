import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as 'email' | 'recovery' | 'invite' | null

  // Collect cookies written during auth exchange so we can copy them to the final redirect
  const pendingCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          pendingCookies.push(...cookiesToSet)
        },
      },
    }
  )

  let userId: string | null = null

  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type })
    if (!error) userId = data.user?.id ?? null
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) userId = data.user?.id ?? null
  }

  let destination = `${origin}/login`

  if (userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('course')
      .eq('id', userId)
      .maybeSingle()

    destination = profile?.course ? `${origin}/dashboard` : `${origin}/onboarding`
  }

  const response = NextResponse.redirect(destination)
  pendingCookies.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
  )
  return response
}
