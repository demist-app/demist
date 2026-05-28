import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const clientId = process.env.NOTION_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'Notion integration not configured' }, { status: 500 })
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`
  const redirectUri = `${origin}/api/notion/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    owner: 'user',
    redirect_uri: redirectUri,
  })

  return NextResponse.redirect(`https://api.notion.com/v1/oauth/authorize?${params}`)
}
