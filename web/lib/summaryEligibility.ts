import { createClient } from '@/lib/supabase'

// Mirrors the server-side gate in backend/supabase/functions/summarize-session
// (mic-mode recordings need either a declared accessibility need or an active
// lecturer consent for the session's subject before a synopsis is generated).
// The cloud path gets this for free from the edge function's own DB check;
// the on-device path has no server in the loop, so callers using
// native.summarize() must run this themselves first.
export async function isEligibleForSummary(subject: string | null, supportNeed: string | null | undefined): Promise<boolean> {
  if (supportNeed && supportNeed !== 'none') return true
  const supabase = createClient()
  const normalizedSubject = (subject ?? '').trim().replace(/[%_]/g, c => '\\' + c)
  const { data: consent } = await supabase
    .from('lecturer_consents')
    .select('id')
    .ilike('module_name', normalizedSubject)
    .maybeSingle()
  return !!consent
}
