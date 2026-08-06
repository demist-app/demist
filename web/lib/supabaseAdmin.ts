import { createClient } from '@supabase/supabase-js'

// Service-role client: bypasses RLS entirely. Server-only, and the missing
// NEXT_PUBLIC_ prefix on the key is what enforces that - a client component
// importing this fails the build instead of shipping the key to a browser.
//
// Not a module-level singleton: the env var is read per call so a missing key
// throws at request time with a message that names it, rather than at import
// time as an opaque build failure.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
