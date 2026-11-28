# crop_set2.py <work dir> <outbox seasons dir> <name>... — same rule as crop_seasons.py: centred 16:9 crop of each Higgsfield
# original (4096x2323 -> 4096x2304), Lanczos down to 3840x2160. Never overwrites. Owner's Higgsfield jobs (2026-11-28, set 2):
# pastel-farmhouse 656afa84, pastel-footbridge 9b4e14d8, sunflower-barn 156d75fa, sunflower-lighthouse 97672800,
# carnation-church d5c40404, carnation-windmill 043c5b54, dahlia-thatched-cottage 52630c2c, dahlia-brick-manor 14990cae.
# Set 3 (same rule): spring-tudor-cottage ed90e827, spring-wisteria-pergola 657006ce, summer-tuscan-villa 46ca66e0, summer-columned-house 8ce5cfb2,
# fall-log-cabin b2ce6860, fall-water-mill 32d40db8, winter-chalet 9cbbf326, winter-red-cottage 70346366.
import sys, os
from PIL import Image
D, O = sys.argv[1], sys.argv[2]
for n in sys.argv[3:]:
    dst = os.path.join(O, 'bg-%s-3840x2160.png' % n)
    if os.path.exists(dst): print('EXISTS, skipped', dst); continue
    im = Image.open(os.path.join(D, n + '-original.png')).convert('RGB'); w, h = im.size
    ch = round(w * 9 / 16); y0 = (h - ch) // 2
    out = im.crop((0, y0, w, y0 + ch)).resize((3840, 2160), Image.LANCZOS); out.save(dst, optimize=True)
    print(os.path.basename(dst), 'crop', (0, y0, w, y0 + ch), '->', out.size, os.path.getsize(dst), 'B')
