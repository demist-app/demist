# Growth tools

Free tools for finding the places students and universities already look, so a
person can reach them. None of these post or send anything. Every email and
every reply is read and sent by a person.

Output goes to `growth/out/` (git-ignored, because it holds contact lists).
Keys go in `growth/.env` (git-ignored):

```
OPENAI_API_KEY=...          # citations.mjs, and threads.mjs --draft
REDDIT_CLIENT_ID=...        # threads.mjs (free "script" app: reddit.com/prefs/apps)
REDDIT_CLIENT_SECRET=...
REDDIT_USERNAME=...
```

## The three tools

| Tool | What it answers | Cost |
|---|---|---|
| `node growth/citations.mjs` | When a student asks an assistant for a lecture app, is Demist named, and which pages does it cite? Writes `out/ballot.csv`: cited pages that do not mention Demist yet, most-cited first. | A few pence per run (OpenAI web search) |
| `node growth/offices.mjs --country "United Kingdom" --limit 50` | Which university disability offices talk about note-taking or assistive technology, which tools they already name, and their shared inbox. Writes `out/offices-best.csv`. Re-runs skip universities already scanned; use `--offset` to page through. | Free (reads each university's own sitemap, obeys robots.txt) |
| `node growth/threads.mjs [--draft]` | Reddit threads from the last week where a student is asking for what Demist does. Writes `out/threads/<date>.md`, with an optional suggested reply per thread. | Free (official Reddit API), drafts a fraction of a penny |

If Reddit API access is not available, set up free keyword alerts at
[F5Bot](https://f5bot.com) for: `lecture app`, `record lectures`, `transcribe lectures`,
`note taking adhd`, `genio alternative`, `otter for lectures`. The alerts arrive by email.

## Weekly routine (15 to 60 minutes a day)

- **Monday:** `citations.mjs`. Compare Demist's rank with last week in `out/citations-history.csv`. Take the top of `out/ballot.csv`: list articles get a short, specific note to the author (point out a dated entry, offer a test account); Reddit threads get a helpful reply if still open.
- **Daily:** `threads.mjs --draft`. Answer two or three threads where a reply genuinely helps. Edit the draft so it sounds like you.
- **Twice a week:** 10 to 20 disability-office emails from `out/offices-best.csv`, highest priority first, personalised with the page and tools they name.

## Rules for anything a person sends

- Answer the actual question first. Name other options fairly.
- Always say "I help make Demist" / "I'm from Graceful Minds". Never pose as a neutral student.
- No "AI" in our own words, no em dashes, no medical claims, and say what Demist will not do.
- Reddit: follow each subreddit's rules; if it bans self-promotion, only mention Demist when someone asks.
- Email: shared office inboxes only (never named staff scraped from pages), one follow-up at most, and stop if they say no.
