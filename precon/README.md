# Your Build Journey — pre-construction meeting presentation

Standalone page. NOT part of the scheduling app: it lives in this folder, and is deployed as its own Netlify site
(drag the zip made from this folder's files). The main site zip does not include it.

## Add / change pictures and videos
- **Pictures:** put your own photos in `media/` named `welcome`, `pre`, `p1` … `p6` (`.jpg`, `.png` or `.webp`). A slot with no photo shows a clean colored panel (the welcome slide shows the STB logo).
- **Videos:** open `index.html`, find `var MEDIA = {…}` at the top of the script and paste a Loom / YouTube / Vimeo / .mp4 link into the
  `video:''` of that phase. A phase with a link shows a "Watch the short video" button that opens a player; without one it shows "Coming soon".
- **Quick test on one device:** open the page with `?edit=1` (e.g. `…/index.html?edit=1#4`) to paste a video link or choose an image for a
  phase. That is saved on that device only (not for everyone) — use it to try things, then send the final link/file to be added for good.

## Words
All text is in the `UI` and `PH` objects (English + Spanish). Phase content mirrors the scheduling app's PHASE_TASKS but leaves out
internal items (QC visits, who is responsible, costs, the bank account, the 4-5 month goal, etc.).

## Sign-off
Last slide: client checks each phase, ticks "my questions were answered", signs on screen (a second signer is optional).
Saved to the cloud row `stb_precon_signoffs_v1` (table `stb_app_state`, same Supabase project as the scheduling app; one record per signing,
with the signature images) and on the device; "Print / save a PDF copy" produces a one-page record. If offline it uploads later.
The wording is an acknowledgment that the presentation was given, not a contract change — have it reviewed before relying on it legally.

## Keys
← → / space: move · F: full screen · L: English/Español · phase buttons at the top jump to a phase · swipe on a phone.
