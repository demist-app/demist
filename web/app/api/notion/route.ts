import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://demist.app'

export async function GET(req: NextRequest) {
  const clientId = process.env.NOTION_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'Notion integration not configured' }, { status: 500 })
  }

  // Require the user to be logged in before initiating OAuth
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Generate CSRF state token and store in HttpOnly cookie
  const state = randomBytes(24).toString('hex')
  const redirectUri = `${APP_URL}/api/notion/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    owner: 'user',
    redirect_uri: redirectUri,
    state,
  })

  const response = NextResponse.redirect(`https://api.notion.com/v1/oauth/authorize?${params}`)
  response.cookies.set('notion_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })
  return response
}
