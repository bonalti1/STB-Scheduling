# stb-summary — read-only access for bots

A Supabase Edge Function that returns a summary of the scheduling boards (Main and Alice)
and the Change Orders tool. It only reads. Whoever holds the bot token can look, never change.

## Deploy (one time, ~5 minutes, Supabase dashboard)

1. Supabase → **any project you control** (ideally the STB one, `ttpkyepzzpxctajrhwvx`, but
   `RolandoJoanPena` works too: the function reads the STB database by address) →
   **Edge Functions** → **Deploy a new function** → "Via Editor". Name it exactly `stb-summary`.
2. Create three files in the editor and paste the contents from this folder:
   `index.ts`, `summary.js`, `phase-tasks.js`.
3. In the function's settings turn **"Verify JWT" OFF** (the bot only needs our token).
4. **Edge Functions → Secrets** → add `BOT_READ_TOKEN` with a long random value
   (for example 40 random letters and numbers). This is the only thing the bot gets.
5. Deploy. The URL is:
   `https://<the project you deployed in>.supabase.co/functions/v1/stb-summary?token=<BOT_READ_TOKEN>`
   (for RolandoJoanPena that is `https://wwzsgfzfjykcvyoimwva.supabase.co/functions/v1/stb-summary?token=…`)

Test it in a browser with the token. You should see JSON with `boards` and `changeOrders`.

## What to give the bot

- The URL above (with the token). Nothing else: no Supabase key, no dashboard login, no Netlify.
- Tell it: `GET` only. `?format=text` returns a plain-text digest that reads well for an LLM;
  the default returns JSON. `?area=main`, `?area=alice`, `?cobros=0` narrow the result.
- `?days=14` (default) controls how much activity history comes back (0–365). The activity
  feed lists every recorded action with who and when: tasks checked/un-checked (with the
  undo reason), status changes, task deletions, delays, houses removed/completed/restored,
  today's tasks added/done/removed, document uploads, address edits. Each checked task also
  carries `completedAt` / `completedBy`. Completed houses and Lessons Learned are included.
- Daily: have the bot call the URL once a morning. On demand: it can call it any time.

## Does a Netlify deploy affect the bot?

No. The bot reads the database, not the web page. Deploying new HTML never changes its
access. Only two things ever need attention: the checklist copy (below) when phases/tasks
change, and the function itself if the data format changes (both live in this repo).

## Keeping it in sync

The function carries a copy of the master checklist (phases and tasks). After any change
to `PHASE_TASKS` in `index.html`, run:

    node tools/build-summary-fn.mjs

then paste the new `phase-tasks.js` into the function in Supabase and redeploy.

## Rotating the token

Change `BOT_READ_TOKEN` in Supabase secrets. The old URL stops working immediately.
