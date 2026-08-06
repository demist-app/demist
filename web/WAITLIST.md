# Pro waitlist — double opt-in setup

Joining the waitlist used to be a direct client-side `INSERT` with the public
anon key. It now goes through a server endpoint that emails a confirmation link,
because a token the visitor must not see and a mail API key that must not reach
a browser are both impossible in a client-side write.

Two emails: **confirm your email** on submit, **you're in** once the link is
clicked.

## What has to be configured

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + `web/.env.local` | Supabase → Settings → API. **Not** `NEXT_PUBLIC_`. |
| `RESEND_API_KEY` | Vercel + `web/.env.local` | resend.com → API Keys. Sending permission is enough. |
| `WAITLIST_ADMIN_KEY` | Vercel + `web/.env.local` | Any long random string. Only the backfill script uses it. |
| `WAITLIST_FROM` | Vercel (optional) | Defaults to `Demist <hello@demist.app>`. Must be on a domain verified in Resend. |
| `WAITLIST_REPLY_TO` | Vercel (optional) | Set if replies should go somewhere other than the From address. |
| `NEXT_PUBLIC_APP_URL` | Vercel (optional) | Defaults to `https://demist.app`. Only matters if the domain changes. |

Generate the admin key with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Resend domain verification

Sends will 403 until `demist.app` is verified. In Resend → Domains → Add
domain, then add the DKIM/SPF records it gives you to the DNS for `demist.app`.
Verification is usually minutes but the TTL can make it longer.

Until that is done, Resend only delivers to the address the account was
registered with — which is enough to test the whole flow end to end.

## Order of operations

The last statements in migration 026 revoke anon's `INSERT` grant. Until
`/api/waitlist/join` is deployed, that grant is the **only** way anyone can
join, so pulling it early breaks the form for every visitor in between.

**Adding a variable in Vercel does not affect a deployment that is already
built.** Vercel captures env vars into a deployment at build time, so a key
added after the build is invisible to it — `/api/waitlist/verify` redirects to
`?status=error` and joins return 500. Redeploy (or push) after adding any of
these.

1. Set the env vars in Vercel and deploy.
2. Run `backend/supabase/migrations/026_waitlist_verification.sql`, then
   `027_waitlist_service_role_grant.sql`, in the Supabase SQL editor. 027 is
   not optional — without it every server-side script that reads the table
   directly fails with `permission denied`, because 020 granted the table to
   `authenticated` but never to `service_role`. The endpoints themselves work
   either way, since they only call SECURITY DEFINER functions.
3. `node scripts/test-waitlist.mjs` — checks the migration actually took, and
   sends no email, so it is safe against production.
4. Join the waitlist yourself on the live site and click the link.
5. Backfill (below).

## Backfilling the people already on the list

Those rows were created by someone typing an address into a form that never
checked it belonged to them, so they are treated as **unconfirmed** and asked to
confirm rather than being marked verified and mailed as though they had.

```powershell
cd web
node scripts/send-waitlist-verifications.mjs          # dry run, lists who would get one
node scripts/send-waitlist-verifications.mjs --send   # actually sends
```

It posts to the live `/api/waitlist/join` with the admin key, so every address
takes the identical path a real visitor takes — there is no second
implementation to drift. Safe to re-run: by default it only picks up rows that
have never been mailed, so an interrupted run resumes where it stopped.

Anyone who ignores the email stays unconfirmed and drops off. That is the point.
The alternative is broadcasting to unproven addresses from a domain with no
sending history and learning about the typos and spam traps by way of a
reputation that cannot be repaired.

`--resend` widens it to everyone still unconfirmed, including those already
mailed once. That is a reminder to people who did not click, and it should be a
deliberate decision, not something that happens by running the command twice.

## Who is actually on the list

`verified_at IS NOT NULL` is the list. Everything else is an unproven address.

```sql
select count(*) filter (where verified_at is not null) as confirmed,
       count(*) filter (where verified_at is null)     as unconfirmed
from pro_waitlist;
```

## Things worth knowing

- **Mail scanners click the link.** Outlook Safe Links and most corporate
  filters fetch every URL in a message before the human sees it, which confirms
  the address on their behalf. Accepted deliberately — a "yes really" button
  would cost more genuine confirmations than the scanners cost accuracy. What it
  must not do is send the welcome twice, and `waitlist_verify()` claims
  `welcomed_at` in the same statement that sets `verified_at` so a prefetch and
  a real click cannot both win it.
- **Only the hash of the token is stored.** Read access to `pro_waitlist` does
  not confer the ability to confirm as anyone in it.
- **Rate limiting.** The per-IP window in the route is best-effort — serverless
  instances are recycled and requests fan out across them. The limit that holds
  is the 90-second per-address cooldown inside `waitlist_join()`, which lives in
  the database where every instance can see it.
- **Telling someone "you're already confirmed" discloses that they are on the
  list.** Accepted knowingly: this is a marketing waitlist, not an account, and
  saying "check your inbox" for a mail we deliberately did not send sends people
  hunting through spam folders for nothing.
- Links last 7 days. Expired ones say so rather than reporting as broken.
