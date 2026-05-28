import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/import?notion_error=${error ?? 'no_code'}`)
  }

  const clientId = process.env.NOTION_CLIENT_ID!
  const clientSecret = process.env.NOTION_CLIENT_SECRET!
  const redirectUri = `${appUrl}/api/notion/callback`

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
    return NextResponse.redirect(`${appUrl}/import?notion_error=token_exchange_failed`)
  }

  const token = await tokenRes.json()

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
    return NextResponse.redirect(`${appUrl}/login`)
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

  return NextResponse.redirect(`${appUrl}/import?notion_connected=1`)
}
