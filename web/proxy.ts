import { NextRequest, NextResponse } from 'next/server'

// Optimistic server-side auth check: redirect unauthenticated requests before
// they reach app pages. The client-side guard in (app)/layout.tsx remains as
// a second layer for full JWT validation.
// NOTE: @supabase/ssr cannot be imported in proxy.ts — use cookie presence check only.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only guard app routes
  const isAppRoute =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/flashcards') ||
    pathname.startsWith('/glossary') ||
    pathname.startsWith('/history') ||
    pathname.startsWith('/import') ||
    pathname.startsWith('/profile') ||
    pathname.startsWith('/stats') ||
    pathname.startsWith('/onboarding')

  if (!isAppRoute) return NextResponse.next()

  // Check for Supabase session cookie (sb-<project-ref>-auth-token)
  const hasSession = request.cookies.getAll().some(
    (c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token') && c.value.length > 0
  )

  if (!hasSession) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/flashcards/:path*',
    '/glossary/:path*',
    '/history/:path*',
    '/import/:path*',
    '/profile/:path*',
    '/stats/:path*',
    '/onboarding/:path*',
  ],
}
