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
- `ordenes.html` + `lib/orders-engine.js` + `lib/pdf*.js` — **STB Purchasing & Ordering** (Jackie's
  selections/allowances/orders tool, opened from the board's 🛒 Orders button). Her Node server was
  rebuilt as a browser engine on Supabase (row `stb_orders_v1`, files in bucket folder `ordenes/`);
  her catalog/budget/selections/plan rules are copied verbatim. Access key default `STB2026`
  (stored hashed). The PDF readers (selections, plans, contract) run in the browser on pdf.js and were
  checked identical to her Node readers on her real PDFs.
- `driver.html` — Robert's phone page (pickups/deliveries), same access key.
- `supabase/functions/read-contract` — AI contract reader (Claude reads text + photographed pages and
  returns allowance figures for a person to confirm). Deployed in Supabase project `krpylhnklvhanmztkgnp`
  under the name **rapid-worker** (Verify JWT off). Secrets: `ANTHROPIC_API_KEY`, `CONTRACT_TOKEN`
  (the Orders page sends it; entered per computer in Orders → Settings → Contract reader).
- **When Jackie sends a new zip of her desktop tool:** the code of the cloud version is generated from
  hers; it is not edited by hand. Ask for a rebuild from the new zip, then Settings → "Bring over the old
  desktop tool" (tick "Replace…" to refresh houses already here — a backup downloads first). Better: she
  works in the cloud page only, so there is one copy of the data.
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

## Read-only bot access (added Sep 29, 2026)
- `supabase/functions/stb-summary/` is a Supabase Edge Function that returns a read-only
  summary (JSON or `?format=text`) of the Main + Alice boards and Change Orders. Auth is a
  single secret `BOT_READ_TOKEN` (Supabase secret). Deploy steps in that folder's README.
- It embeds a copy of the master checklist; after editing `PHASE_TASKS` in `index.html`,
  run `node tools/build-summary-fn.mjs` and re-paste `phase-tasks.js` into Supabase.
- Give bots ONLY the function URL + token. Never the publishable key (it can write).
- **Deployed (Sep 29, 2026):** the function is live in Supabase project `krpylhnklvhanmztkgnp`
  ("South Texas Builders Scheduling"), under the function name **`rapid-processor`** (not
  `stb-summary`). It reads the real STB data at `ttpkyepzzpxctajrhwvx` by address.
  URL shape: `https://krpylhnklvhanmztkgnp.supabase.co/functions/v1/rapid-processor?token=<BOT_READ_TOKEN>`.
  Verify JWT is OFF. The token lives only in Supabase secrets and in the Grok bot. Never write it here.
- Which login owns the app's own project `ttpkyepzzpxctajrhwvx` (morning text, cron) is still unknown.

## Viewer role — read-only board for field employees (added Oct 8, 2026)
- `USERS` in `index.html` now has `{role:'viewer', name:'Roberto', password:'916303'}` (PIN is plain text in
  the page source like the other passwords — a courtesy lock, not real security). Add more field employees
  by adding more `role:'viewer'` entries.
- **A viewer sees everything and can change nothing.** Enforced in the DATA layer, not only the UI
  (`ROLE_CAPS` / `isViewerSession()` near the Supabase constants; fail-closed — any role not explicitly
  `write:true` is read-only):
  - `window.fetch`, `XMLHttpRequest.open`, `navigator.sendBeacon` are wrapped: for a viewer every
    non-GET/HEAD request is refused, whichever code made it (saves, uploads, AI, save-check, restore).
  - Explicit guards too: `queueSave`, `saveBoardNow`, `persistBoard`, `persistAutoBackup`, `Store.set`,
    `supabaseSet`, `supabaseRawSet`, `supabaseSaveBoardCAS`, `openAI`/`askAI`. His phone can never overwrite
    the board with an older copy, and the load-time auto-saves stay silent too.
  - Front end: `body.viewer` hides every button except an allow-list (`VIEWER_OK_BUTTONS`: close, Export Report,
    Subcontractors / Lessons / Completed Houses to read, map/blueprint/render links, phase tabs, budget, delays,
    notes to read). Default-deny: any NEW button added later is hidden for viewers until it is allow-listed.
    Inputs/selects/checkboxes are disabled, contenteditable is turned off, drops are swallowed, and a
    capture-phase handler swallows stray clicks. Hidden for viewers: Add Project, Start Meeting, Operations AI,
    Backup, Change Orders, Orders, day arrows, Complete House, every edit/add/delete/upload.
  - "View only · Roberto" badge in the header. An open viewer page re-reads the board every 60 s and when the
    tab becomes visible (`viewerRefresh`), so a phone left open never shows a stale board.
- **Open from Employee OS without typing the PIN:** link `https://stb-scheduling.netlify.app/#code=<PIN>`.
  Read once, then removed from the address bar/history (`history.replaceState`). Only view-only PINs work this
  way — an owner/scheduler PIN in a link does nothing.
- **Room for later — "assigned to":** `ROLE_CAPS.viewer.ownTasks` (off) and `viewerMayChangeTask(el)` (returns
  false) are the hooks. To let a viewer check off only his own tasks: (1) put `assignedTo:<name>` in the task
  state (`phaseTaskState[phase][task]`) and add a way to set it; (2) turn `ownTasks` on and make
  `viewerMayChangeTask` check the row's `assignedTo === currentUserName()`; (3) the data-layer guard must then
  allow ONE narrow write path (the compare-and-set board save, with the merge that already protects against stale
  copies) for those toggles only — today `isViewerSession()` refuses all writes.
- **Honest limits:** the PIN check and the guards are in the browser; the Supabase publishable key can still write
  (the board has no server-side login), so a determined person using developer tools could bypass them. Real
  enforcement would need Supabase RLS / a function that checks a token. The viewer cannot reach Change Orders /
  Orders from the board (buttons hidden), but those pages have their own gates if someone types the address.
