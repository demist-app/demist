import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://demist.app'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const stateParam = searchParams.get('state')

  if (error || !code) {
    return NextResponse.redirect(`${APP_URL}/import?notion_error=${encodeURIComponent(error ?? 'no_code')}`)
  }

  // Validate CSRF state
  const cookieStore = await cookies()
  const storedState = cookieStore.get('notion_oauth_state')?.value
  if (!storedState || storedState !== stateParam) {
    return NextResponse.redirect(`${APP_URL}/import?notion_error=invalid_state`)
  }

  const clientId = process.env.NOTION_CLIENT_ID!
  const clientSecret = process.env.NOTION_CLIENT_SECRET!
  const redirectUri = `${APP_URL}/api/notion/callback`

  // Exchange code for access token
  const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${APP_URL}/import?notion_error=token_exchange_failed`)
  }

  const token = await tokenRes.json()

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
    return NextResponse.redirect(`${APP_URL}/login`)
  }

  await supabase.from('integrations').upsert({
    user_id: user.id,
    provider: 'notion',
    access_token: token.access_token,
    workspace_id: token.workspace_id ?? null,
    workspace_name: token.workspace_name ?? null,
    bot_id: token.bot_id ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' })

  // Clear the state cookie
  const response = NextResponse.redirect(`${APP_URL}/import?notion_connected=1`)
  response.cookies.set('notion_oauth_state', '', { maxAge: 0, path: '/' })
  return response
}
