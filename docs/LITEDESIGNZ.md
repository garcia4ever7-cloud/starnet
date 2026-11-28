# LiteDesignz — flagship product line "Garden of Memories" (record, updated 2026-11-28)

This is the one place that holds the LiteDesignz facts. `handoff.md` and `CLAUDE.md` point here. Live paths are under
`~/.local/share/StarNet/workspaces/` (W).

## The line
- **Shop:** LiteDesignz (Etsy). It is a separate shop from knight4christ's KJV print shop. The KJV rules stay for knight4christ.
- **Flagship (owner, 2026-11-28):** "LiteDesignz Garden of Memories" is our flagship product line. Every agent uses this style and
  theme by default for LiteDesignz work.
- **Style file:** `W/webdesigner/styles/litedesignz-garden-of-memories.md` (status active, main LiteDesignz style). Its row in
  `styles/index.md` says it is the default for any LiteDesignz product. The look:
  - a photoreal cottage-garden scene in soft natural light
  - a building in the background (chapel, cottage, gazebo, etc.)
  - real seasonal flowers in the foreground
  - an open, calm centre for a photo or text
  - no text or verses in the art
  - made at 4K, then cropped to 3840x2160
- **Shop text:** v2 by PUBLISHER (run `7e2f6ed2`, $0.08), saved as `W/publisher/outbox/litedesignz/shop-text-drafts-v2.md`.
  - Shop title: "Garden Floral Digital Keepsakes and Memorial Designs" (52 characters).
  - No KJV, verses or watercolor. The Nov 27 v1 drafts are kept.
- **Branding in the Outbox:**
  - Banner v5: `W/webdesigner/outbox/litedesignz/banner-3360x840-v5.png`, with "LiteDesignz" lettered by Higgsfield (job `9e9c5ccf`).
  - Icon v4: `W/webdesigner/outbox/litedesignz/icon-500x500-v4.png`.
  - Older banners v1–v4 and icons v1–v5 are kept.
- **Etsy:** uploading to Etsy is blocked by a sign-in error, so the owner uploads by phone. Agents never upload to Etsy.
- **Products:** digital downloads first. Slideshows versus digital downloads is not decided yet.

## Master images (owner's Higgsfield jobs)
| Image | Original job | 4K / widened job |
|---|---|---|
| Garden master | `f961bb96-83be-40ce-bc5d-6939a30e55ab` (2688x1520) | `98f074fa-425d-4e73-83f8-30020cc4d9c7` (5090x2160) |
| Peony "Eternal Love" | `ed347807-9f25-46a1-b5e6-e13a9c15cd5b` | `85c562e9-69d8-4c5e-b7e9-c0b7ea0a9264` (5090x2160) |

The sources are in `W/webdesigner/workshop/hf-litedesignz-redo/`, along with `crop_redo.py`.

## The 20 slideshow backgrounds
- **Source:** the owner's Higgsfield jobs, each 4096x2323. Claude Code only downloaded them, with $0 StarNet spend.
- **Originals:** `W/webdesigner/workshop/hf-litedesignz-seasons/<name>-original.png`.
- **Crops:** `W/webdesigner/outbox/litedesignz/seasons/bg-<name>-3840x2160.png`. Each is a centred 16:9 crop
  (0,9)-(4096,2313), scaled down with Lanczos to 3840x2160. The scripts are `crop_seasons.py` and `crop_set2.py`.
- **Registered:** all 40 files (20 crops and 20 originals) are in CENTRAL OUTBOX (project `litedesignz`, runId
  `hf-litedesignz-seasons`) and in MY WORK ▸ DELIVERABLES (cards `litedesignz-season-*`), as "LiteDesignz seasonal slideshow
  backgrounds".
- **Checked:** every file was fetched the way the page fetches it and is byte-identical to the saved file. QC passes 20/20.
- **Helpers:** `register-set.sh` and `verify-set.mjs` are in the same workshop folder.

| Set | Name | Higgsfield job |
|---|---|---|
| 1 seasons | spring (white chapel) | `e3dad384-9197-4e4e-b9fe-2197ce3c7ef0` |
| 1 seasons | summer (Victorian greenhouse) | `9b7a4dac-a030-4eab-ac31-7da45d58a643` |
| 1 seasons | fall (stone cottage) | `7fb36942-40d9-42fa-abf9-5566d0edd2f9` |
| 1 seasons | winter (gazebo with lights) | `afc2536c-53bf-48b3-b153-f86862a937f6` |
| 2 owner bouquets | pastel-farmhouse | `656afa84-b564-413e-a4f4-927daedf9005` |
| 2 owner bouquets | pastel-footbridge | `9b4e14d8-9c58-4d5f-a0e7-8f537abb651a` |
| 2 owner bouquets | sunflower-barn | `156d75fa-d02c-45d3-b527-395e67b3edfa` |
| 2 owner bouquets | sunflower-lighthouse | `97672800-15a7-4cb5-bb47-3198a8f54336` |
| 2 owner bouquets | carnation-church | `d5c40404-b8d2-4df3-95f9-8d0e31a03fcd` |
| 2 owner bouquets | carnation-windmill | `043c5b54-fd3a-4dee-8d25-0e03d83ebb81` |
| 2 owner bouquets | dahlia-thatched-cottage | `52630c2c-2eeb-45e0-a6d0-8ea5d28790a6` |
| 2 owner bouquets | dahlia-brick-manor | `14990cae-3603-462c-a33b-33c24f8a8d12` |
| 3 remembrance flowers | spring-tudor-cottage | `ed90e827-779a-48a4-9f51-f24058262cd5` |
| 3 remembrance flowers | spring-wisteria-pergola | `657006ce-5a41-4839-8243-a2fec5c86ac3` |
| 3 remembrance flowers | summer-tuscan-villa | `46ca66e0-0ead-4f95-8e3f-ec298d64377c` |
| 3 remembrance flowers | summer-columned-house | `8ce5cfb2-b832-4fe4-a240-e1a19eb810f8` |
| 3 remembrance flowers | fall-log-cabin | `b2ce6860-ae53-4298-bb63-4a0e4c554ac9` |
| 3 remembrance flowers | fall-water-mill | `32d40db8-26d5-4640-bc05-5449d2f2a68d` |
| 3 remembrance flowers | winter-chalet | `9cbbf326-2365-4a24-885e-686cded8c2df` |
| 3 remembrance flowers | winter-red-cottage | `70346366-82ca-47bf-9d11-7befb5b0c780` |

**Higgsfield credits (owner's figures, 2026-11-28):** 82 used in total, 840 left.

## Outbox check (2026-11-28)
**Higgsfield-vs-Outbox check (2026-11-28 ~08:50 PST, $0): 59 LiteDesignz images in BOTH CENTRAL OUTBOX and DELIVERABLES, byte-verified by page-style ticketed fetch, no duplicates.** 8 added: garden master `f961bb96` and its 4K `98f074fa`, peony "Eternal Love" `ed347807` and its 4K `85c562e9`, banner v5 source `9e9c5ccf`, icon v3 base `33a0bd39` and its 4K `a05ad363` (each registered in BOTH views), and icon v3's DELIVERABLES card re-added as `litedesignz-icon-500x500-v3-card2` (the old card was cleared 11-27 10:44 and a cleared ID stays hidden). Left out on purpose: the 25 Higgsfield 2K drafts made before each upscale and the 2 widening (outpaint) steps — the same pictures at lower resolution; the style file is a note, not an image (exists, not registered). Backups `.deliverables/manifest.jsonl`, `deliverables.library.jsonl`, `deliverables.store` `.bak-20261128-hfcheck`. Check script + result: `docs/litedesignz/verify/` (`check-all.mjs`, `final.txt`).

## Rules for this line
- Everything goes through StarNet and the Outbox, registered in both CENTRAL OUTBOX and DELIVERABLES.
- Higgsfield is the tool for upgrading images. Show the credit cost before any Higgsfield job.
- No Bible verses on shop images.
- Agents run unattended inside their caps. Nothing is published to Etsy by an agent.

## Who knows the flagship (2026-11-28)
The note text is kept in `docs/litedesignz/flagship-note.txt`.
- **DESIGNER, PUBLISHER and SCOUT:** a short flagship note was added at the end of each one's `context` doc.
  - How: through StarNet's own routes. `POST /api/save` took it to rev 5763 -> 5764, then a full-roster `POST /api/roster`
    (count 10) followed.
  - Checks: integrity CONSISTENT, and both copies carry the note.
  - Backups: `agent.save.json`, `agent.roster.json`, `authority-seal.json` and `cron.jobs.json`, each with the suffix
    `.bak-20261128-flagship`.
- **NIGHT4CHRIST: held back, not edited.** Its instructions are part of Monday's chain grant fingerprint (`grantDrive …cb99ede2`;
  `GrantedContext.instructionsOf` covers identity, purpose, context and manual). Any dossier edit would make the 03:00 chain run
  without `orchestrator` until the owner re-grants it in SCHEDULES with a desk code.
  - Checked after the edit: its roster row is byte-identical and instructionsOf is still 7,899 characters.
  - NIGHT4CHRIST still gets the style default through DESIGNER's `styles/index.md`. Starmem notes do not reach StarNet agents;
    starmem is Claude Code's memory.
- **SCOUT side effect:** the disabled routine `3d117f09` ("Research Etsy for new product opportunities", grant `connectors`) was
  fingerprinted on SCOUT's old instructions. If it is ever turned back on, re-grant it in SCHEDULES. The chain `ebc4f07d` is not
  affected, because its fingerprint covers only NIGHT4CHRIST.

## Briefs and run helpers
These are copied from the Claude Code session scratchpad into `docs/litedesignz/`:
- `brief-designer.md` and `brief-designer-go.md` (Nov 27 attempt 1)
- `brief-designer-v1-build.md` and `brief-publisher-v1.md` (the Nov 27 build and v1 text)
- `brief-publisher-v2.md` (shop text v2)
- `publisher-reply-v1.txt` and `publisher-reply-v2.txt` (verbatim replies)
- `run-agent.mjs` and `run-agent-text.mjs` (watchdog runners; these read the token from the env and contain no secrets)
- `flagship-note.txt`
