// Retries a Supabase write that failed because the network did, not because
// the database refused it.
//
// WHY (2026-11-06). The writes that close a lecture (its final transcript, end
// time and summary) run the moment the student presses stop, which is also
// when a laptop is most likely to be closing its lid or dropping off Wi-Fi.
// Four desktop students had all three fail in the same second with an empty
// error code (supabase-js's shape for a failed fetch); one paying student lost
// the last part of a lecture's transcript and its summary that way. One try
// was all those writes ever got.
//
// Only network failures are retried. A real database error (a constraint, a
// permission) would fail the same way again, so it returns at once.

type WriteResult = { error: { code?: string | null; message?: string | null } | null }

const DELAYS_MS = [2_000, 6_000, 15_000]

function isNetworkFailure(error: NonNullable<WriteResult['error']>): boolean {
  return !error.code || /fetch|network|timed? ?out|load failed/i.test(error.message ?? '')
}

export async function retryWrite<T extends WriteResult>(run: () => PromiseLike<T>): Promise<T> {
  let result = await run()
  for (const delay of DELAYS_MS) {
    if (!result.error || !isNetworkFailure(result.error)) return result
    await new Promise(r => setTimeout(r, delay))
    result = await run()
  }
  return result
}
