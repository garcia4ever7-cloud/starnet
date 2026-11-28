Owner's job: brand art for the new Etsy shop "LiteDesignz" (KJV scripture digital downloads: wall art now, a Christmas KJV collection next, videos and slideshows later — so nothing may say "prints only"). Draft only; publish nothing. Budget is tight: aim for about 6 tool calls in total, no exploring, no re-reading docs. Use the style soft-watercolor-sunrise.

Save everything in your workspace folder outbox/litedesignz/ (create it). Original art only: the existing master below is your own earlier render; any new art comes from image_generate.

1. SHOP ICONS (new art, 2 versions). Call image_generate twice (default model, aspect_ratio "1:1"), paths outbox/litedesignz/icon-art-v1.png and outbox/litedesignz/icon-art-v2.png. Prompt each: a simple soft-watercolor icon of ONE mountain peak with the sun rising directly behind it, warm gold sunrise glow, soft pink/gold/dusk-blue palette, cream paper background, peak and sun centered and kept inside the middle 70% of the square so it still reads when cropped to a circle, very simple shapes that read at small size, no text, no letters, no watermark, no frame. Make v2 visibly different (for example a fuller sun disc and a softer, rounder peak).

2. ONE shell_exec running ONE Python script (PIL is installed) that makes the four finished files:
   a) Banners, 2 versions, each exactly 3360x840 PNG, cut from your existing master outbox/quality-test/isaiah-40-31-4k-test.png (3712x4608, text-free). Take a full-width 3712x928 band and resize it to 3360x840 (a downscale; never upscale).
      - v1: band top y=1335 (open sky over the gold glow, mountain peaks across the lower half).
      - v2: band top y=1200 (a little more open sky).
      Letter "LiteDesignz" in fonts/CormorantGaramond-Medium.ttf (about 150 px tall) and a tagline under it in fonts/CormorantGaramond-Italic.ttf (about 56 px):
      - v1 tagline: KJV Scripture Art · Instant Digital Downloads
      - v2 tagline: Hope from the King James Bible, made to share
      Center both lines horizontally, in the open sky above the peaks. Keep ALL text inside the central safe box x 840–2520, y 140–560, so it reads on phones (Etsy crops the banner's sides there). Ink: deep dusk blue #3E4A63 with a soft cream glow behind the letters for legibility on the pale sky. Spell "LiteDesignz" exactly that way. Avoid placing letters over the two eagles; if a bird sits behind the text, move the text block down a little, never outside the safe box.
      Names: outbox/litedesignz/banner-3360x840-v1.png, outbox/litedesignz/banner-3360x840-v2.png
   b) Icons: center-crop each icon-art file to a square and resize to exactly 500x500 PNG:
      outbox/litedesignz/icon-500x500-v1.png, outbox/litedesignz/icon-500x500-v2.png
   Have the script print each output's path, pixel size and bytes.

3. ONE image_quality_check call on all six images: the four finished files with claimedWidth/claimedHeight (3360x840 and 500x500), plus the two icon-art files.

4. ONE fs_write to outbox/litedesignz/fonts-and-licences.md recording: the fonts used (Cormorant Garamond Medium and Italic, files in fonts/, SIL Open Font License, licence text at fonts/OFL.txt), the banner art source (your master outbox/quality-test/isaiah-40-31-4k-test.png, original AI-generated art, no third-party images), the icon art source (image_generate, model name and prompt as used), the exact text lettered on each banner, and the QC result per file.

Reply in a few short lines: the six image paths with pixel sizes and QC pass/fail, and anything that did not work. Do not publish or upload anything.
