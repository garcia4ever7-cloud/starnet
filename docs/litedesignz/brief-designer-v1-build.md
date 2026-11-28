Owner's job: shop branding for the new Etsy shop "LiteDesignz" (KJV scripture digital downloads: wall art and faith journals now, a Christmas KJV collection next, videos and slideshows later — never say "prints only"). Draft only; publish or upload nothing. Tight budget: exactly these tool steps, no exploring, no reading docs or style files:
  step 1: ONE fs_write of the script below
  step 2: ONE shell_exec with cmd "python3 scripts/build_litedesignz.py" (exactly that; no other shell commands, no backslashes in any command)
  step 3: in ONE turn, both: image_quality_check on the four finished files AND fs_write of the record file
  step 4: a short reply.

STYLE (owner's words): NOT watercolor. Light: cream paper, flowers framing the corners, a gold flourish frame, soft blue / blush colored clouds where they help. Palette: blush and pink roses, peach and coral dahlias, cream and white blooms, apricot garden roses, a touch of magenta, sage and eucalyptus green; gold #C9A55B / #B8913F; ink warm brown #5E4636.

SOURCES (all already in your workspace, all the station's own finished work — no new AI images, no image_generate, no downloads):
  refs/litedesignz/title-floral-1080p.png   1536x1024, cream paper, blush rose clusters in the top-left and bottom-right corners, empty cream centre
  refs/litedesignz/cover-art-A.png          896x1200, pastel blush/blue/lilac cloud sky, roses, thin gold frame
  refs/litedesignz/cover-art-B.png          896x1200, same family
  outbox/design/cover-rooted-reflecting-8.5x11-300ppi.png                    finished journal cover (featured product)
  outbox/isaiah-40-31-4k-kit/isaiah-40-31-ratio-4x5-4800x6000.jpg             finished KJV print (featured product)
  outbox/philippians-4-13-4k-kit/philippians-4-13-ratio-4x5-4800x6000.jpg     finished KJV print (featured product)
  fonts/CormorantGaramond-Medium.ttf, fonts/CormorantGaramond-Italic.ttf (SIL OFL, fonts/OFL.txt)
Never enlarge any source crop by more than 1.6x (Lanczos). Downscaling is fine.

STEP 1 — fs_write scripts/build_litedesignz.py: a PIL script that writes these four PNGs (RGB, cream not transparent) into outbox/litedesignz/ and prints each path, pixel size and bytes:

  A) outbox/litedesignz/banner-3360x840-v1.png (brand banner)
     - Background: cream paper #FAF4EA with the paper grain sampled from the empty centre of title-floral (tile or stretch a centre patch, then blend it over the cream at ~60%).
     - Flowers framing the corners: cut the top-left and bottom-right rose clusters out of title-floral with a soft feathered mask; place them at the banner's top-left and bottom-right, and mirrored copies at top-right and bottom-left; each at most 1.6x its source size; keep them out of the text zone.
     - Gold flourish frame: a thin double gold line inset ~36 px from the edges, with small symmetric curl flourishes at the middle of the top and bottom edges. Draw at 2x size and downscale for clean anti-aliasing.
     - Clouds: a soft ~35% opacity wash of cover-art-A's pastel cloud sky behind the text zone, feathered on all sides.
     - Text, centred in the safe box x 840-2520, y 160-680 (Etsy crops the banner's sides on phones): "LiteDesignz" in Cormorant Garamond Medium about 160 px tall, ink #5E4636; under it the tagline in Cormorant Garamond Italic about 56 px: KJV Scripture Designs · Instant Digital Downloads
  B) outbox/litedesignz/banner-3360x840-v2.png (featured banner): same background, corner flowers, frame and cloud wash, then:
     - "LiteDesignz" centred near the top (about 120 px tall), tagline under it (about 46 px): Faith-filled KJV art, journals and more
     - Below it, a row of three framed previews centred inside x 840-2520: the Isaiah 40:31 print, the Rooted & Reflecting cover, the Philippians 4:13 print, each scaled DOWN to about 440 px tall, each with a thin gold frame and a soft drop shadow, even gaps. Keep them clear of the corner flowers.
  C) outbox/litedesignz/icon-500x500-v1.png: cream paper square; everything important inside a centred circle of diameter 440 (it must still read when Etsy crops it to a circle): a thin double gold ring and one blush rose cluster from title-floral centred (at most 1.6x its source size).
  D) outbox/litedesignz/icon-500x500-v2.png: cream paper square; inside the same 440 px circle: a thin gold ring, the monogram "LD" in Cormorant Garamond Medium in gold #B8913F, centred, with a small rose sprig from title-floral tucked under it.

STEP 3 — image_quality_check on the four files with claimedWidth/claimedHeight 3360x840 (banners) and 500x500 (icons); AND fs_write outbox/litedesignz/fonts-and-licences.md recording: the fonts (Cormorant Garamond Medium + Italic, SIL Open Font License, licence text at fonts/OFL.txt); every source file used, noting they are the station's own finished work (no third-party images, no new AI generation); which products are featured on banner v2 and their exact lettered text (Isaiah 40:31 KJV: "But they that wait upon the LORD shall renew their strength"; Philippians 4:13 KJV: "I can do all things through Christ which strengtheneth me"; Rooted & Reflecting journal cover); the exact words on each banner and icon; the largest enlargement factor the script used.

Reply in a few short lines: the four file paths, pixel sizes, bytes and QC pass/fail, and anything that did not work.
