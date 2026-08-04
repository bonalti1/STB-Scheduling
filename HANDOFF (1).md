# STB-Scheduling — Project Handoff & Context

**Read this first.** It's the running memory for this project so any new Claude Code
session can pick up exactly where we left off. Keep it in the repo and update it as
things change.

> New session? Just say: **"Read HANDOFF.md"** and I'm caught up.

---

## What this is
Two connected web apps for South Texas Builders (STB):

1. **Scheduling board** — `index.html`. The daily project/house checklist the crews
   and office use. Phases, tasks, delays, renders, blueprints, completed houses,
   per-user logins, Operations AI, and the morning text.
2. **Change Orders (Cobros)** — `change-orders.html` + `firmar.html`. Tracks change
   orders, payment plans, and customer e-signatures. Opened from the **Change Orders**
   button in the scheduling board (gated by an access code — the code is
   `Change Orders`, exactly).

## Files in this repo (the whole site)
- `index.html` — scheduling board (the big one, ~4,500 lines)
- `change-orders.html` — Change Orders / Cobros tool (cloud version)
- `firmar.html` — public customer signing page (opened via a secret-token link)
- `south-texas-builders-logo.png`, `favicon.png` — branding
- `uploads/fotos/…` — seed photo(s) for Change Orders

## How it's deployed (IMPORTANT)
- Hosted on **Netlify** via **Netlify Drop** — you drag a **.zip with all files at the
  root** onto Netlify. **Do not unzip it**, and don't drag a folder (Netlify rejects
  folders). Netlify **replaces the entire site** with the zip contents, so the zip must
  contain *every* file above.
- Live URL: **stb-scheduling.netlify.app**
- Netlify does NOT deploy from this GitHub repo. GitHub is the **source-of-truth backup**.
- **Rule: every deploy ZIP gets saved to Google Drive/Dropbox.** That habit is the real
  safety net — the code was once lost because it lived on a branch that got overwritten.
  One saved zip = the app can always be rebuilt.

## Database — Supabase
- Project ref: `ttpkyepzzpxctajrhwvx`
- Table `public.stb_app_state (id text pk, data jsonb, updated_at timestamptz)`.
- Rows: `stb_board_v1` (the scheduling board), `stb_change_orders_v1` (Change Orders
  data — its OWN row, never touches the board), plus `stb_completed_v1`,
  `stb_render_manifest_v1`, backups, etc.
- The client uses a **publishable** key (safe to ship). Anon can select/insert/update,
  **not delete**.
- **Saving is bulletproof by design** — do not weaken this:
  - Client uses **compare-and-set** saves (`supabaseSaveBoardCAS`) + merge helpers so two
    devices saving at once never overwrite each other.
  - Server trigger `stb_protect_project_renders` re-protects completed tasks, renders,
    addresses, blueprints, and strips deleted/completed projects on every save.
  - Projects are matched by **unique `id` only** — never by code/name (SPEC houses share
    codes and cross-contaminated once).
  - **Never tell Rolando saving works without verifying it live** under stale multi-device
    conditions.

## Morning text (the automatic 9 AM SMS)
- Supabase **Edge Function** `stb-morning-brief` → posts to **HighLevel/LeadConnector**
  webhook, which actually sends the SMS.
- Schedule: pg_cron job **`stb_morning_brief_daily`** (`0 14,15 * * *` UTC, guarded to
  fire only when it's 9 AM America/Chicago → one send/day, year-round). A duplicate job
  `stb_morning_brief_9am` was **deleted** (it caused double texts).
- Recipients + secret token live in **Supabase Edge Function secrets**
  (`MORNING_BRIEF_RECIPIENTS`, `MORNING_BRIEF_SECRET`) — NOT in code. Do not paste those
  values into this repo.

### ⚠️ OPEN ISSUE — morning texts are currently OFF
- The send is failing with **HighLevel "LOCATION does not have enough funds"** (HTTP 422).
  The Supabase side is healthy; the **HighLevel wallet is empty.**
- **Fix:** fund the HighLevel wallet for the STB location + turn on **auto-recharge**.
- Then test immediately (no waiting for 9 AM):
  `select net.http_get(url := 'https://ttpkyepzzpxctajrhwvx.supabase.co/functions/v1/stb-morning-brief?secret=<SECRET>');`
  then check `select status_code, content::text, created from net._http_response order by id desc limit 3;`
  — want **200**, and the 4 phones should buzz.

## ⚠️ CURRENT STATUS (Aug 4, 2026) — READ THIS FIRST
1. **Outage + rollback (RESOLVED):** A Jul 19 Netlify Drop deploy uploaded only 2 files
   and wiped `firmar.html` from the live site → every signing link 404'd. Fixed Aug 3 by
   re-publishing the **Jul 10 3:17 PM** deploy from Netlify's Deploys page. Signing works.
2. **Repo is now the real backup (DONE):** Rolando found `stbschedulingsite (21).zip`
   in his Downloads (the exact Jul 10 deploy zip) and uploaded it. All site files are
   now committed on branch `claude/session-phmsv4`: index.html, change-orders.html,
   firmar.html, favicon.png/svg, logo, uploads/fotos/. **Rule stands: never deploy a
   zip that wasn't built from this repo.** Do NOT include this HANDOFF file in deploy
   zips (it would be publicly readable on the live site).
3. **Payment plan limits (REBUILT, pending deploy):** the update lost in the rollback
   was re-implemented in BOTH `firmar.html` (customer) and `change-orders.html`
   (office): single payment → first payment max 1 month out (min today on customer
   side); quincenal → max 6 pagos; mensual → max 3 pagos. Office side allows past
   start dates so existing in-progress plans stay editable. JS syntax-checked; limit
   logic unit-tested (all cases pass). **Next: Rolando drags the new deploy zip
   (built from this repo) onto Netlify Drop, then team re-tests a contract link.**
4. **Also planned (mastermind session):** a QC/Runner phone view inside `index.html` —
   role-tagged login sees only his tasks (Pre + Phases 1–6) in bold red; check-off syncs
   via existing Supabase save path; photo prompted on most tasks (optional, auto-
   compressed, tap-to-view for everyone). Waiting on Rolando's task-ownership list
   (his / not his + photo required/optional per task).

## Recent work (this session)
- Built the Change Orders cloud tool (ported from an old one-PC desktop app) onto the
  same Supabase, its own row, with the same save protection. 24 automated tests passed.
- Added the **Change Orders** button to the scheduling top bar.
- **Delete a house:** each house has **Edit · Complete House · Delete**. Delete now
  requires **typing `DELETE`** to confirm (guards against accidental taps). It records the
  removal via `removedProjectIds` so a stale device can't resurrect it.
- Removed the duplicate morning-brief cron job.
- Diagnosed the morning-text failure down to the HighLevel wallet (above).

## Still open / TODO
- [ ] **Fund HighLevel wallet** + auto-recharge → confirm the 4 numbers get the 9 AM text.
- [ ] Review `stb-morning-brief/index.ts` source (never seen it): fix a resolved-delay that
      keeps showing ("move house 40 ft back on Hernández"), update its stale internal
      task list (missing Insulation Inspection P3, Tile Delivery P5), make the text simple/
      executive-style.
- [ ] (Optional) Make house Delete **recoverable** (hidden "Deleted" area) instead of permanent.
- [ ] Lot 6 Phase 6 had SPEC-bleed checkmarks to clean up.

## Working rules (from Rolando)
- Saving must be bulletproof; verify live before claiming it works.
- Undo of a completed task requires confirmation + a reason, and records who/when.
- Keep each app in its **own** repo. Save every deploy zip. Don't reuse this repo for
  other projects (that's what caused the earlier code loss).
