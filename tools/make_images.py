"""Generate og-image.png (1200x630 link preview) and icon-180.png (Apple touch icon).

Run from the repo root:   python tools/make_images.py .
Needs Pillow (pip install pillow) and the Segoe UI fonts in C:/Windows/Fonts (change F below on other systems).
After regenerating og-image.png, bump the ?v= number on og:image in index.html
so link-preview caches fetch the new image.
"""
import math, random, sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out = sys.argv[1]
F = "C:/Windows/Fonts/"
bold = lambda s: ImageFont.truetype(F + "segoeuib.ttf", s)
reg = lambda s: ImageFont.truetype(F + "segoeui.ttf", s)
semi = lambda s: ImageFont.truetype(F + "segoeuisl.ttf", s)

BG, ACC, GOLD, TEXT, MUTED = (11, 13, 18), (123, 167, 242), (232, 184, 74), (231, 234, 240), (143, 152, 168)
VIR = [(68, 1, 84), (59, 82, 139), (33, 145, 140), (94, 201, 98), (253, 231, 37)]

def viridis(t):
    t = max(0, min(1, t)) * (len(VIR) - 1); i = min(len(VIR) - 2, int(t)); f = t - i
    return tuple(int(VIR[i][k] + (VIR[i + 1][k] - VIR[i][k]) * f) for k in range(3))

def orbit_logo(d, cx, cy, r, w):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ACC, width=w)
    # tilted orbit ellipse as a polyline
    pts = []
    for k in range(181):
        a = 2 * math.pi * k / 180
        x, y = 1.75 * r * math.cos(a), 0.64 * r * math.sin(a)
        rot = math.radians(-22)
        pts.append((cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot)))
    d.line(pts, fill=ACC, width=w, joint="curve")
    gx, gy = pts[150]
    d.ellipse([gx - w * 1.6, gy - w * 1.6, gx + w * 1.6, gy + w * 1.6], fill=GOLD)

# ---------- og-image ----------
W, H = 1200, 630
MARGIN = 80                       # same as the text's left margin
R = 195
cx, cy = W - MARGIN - R, 330      # globe ends 80px from the right edge
img = Image.new("RGB", (W, H), BG)
# soft blue glow behind the globe
glow = Image.new("RGB", (W, H), BG)
gd = ImageDraw.Draw(glow)
gd.ellipse([W - MARGIN - 2 * R - 90, 60, W - MARGIN + 90, 620], fill=(24, 38, 66))
img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(90)), 1.0)
d = ImageDraw.Draw(img)

# stars
rnd = random.Random(7)
for _ in range(160):
    x, y = rnd.randrange(W), rnd.randrange(H)
    v = rnd.randrange(60, 150)
    d.point((x, y), fill=(v, v, v + 10))

# globe with scored "sites"
globe = Image.new("RGBA", (W, H), (0, 0, 0, 0))
g = ImageDraw.Draw(globe)
for i in range(R, 0, -1):  # radial shading, lit from upper left
    t = i / R
    c = (int(18 + 30 * (1 - t)), int(40 + 55 * (1 - t)), int(78 + 70 * (1 - t)))
    ox, oy = -0.28 * (R - i), -0.3 * (R - i)
    g.ellipse([cx - i + ox, cy - i + oy, cx + i + ox, cy + i + oy], fill=c + (255,))
mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(mask).ellipse([cx - R, cy - R, cx + R, cy + R], fill=255)
img.paste(globe, (0, 0), mask)
d = ImageDraw.Draw(img)
d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(70, 100, 150), width=2)
# graticule
for lat in (-50, -25, 0, 25, 50):
    yy = cy - R * math.sin(math.radians(lat)); rr = R * math.cos(math.radians(lat))
    d.line([(cx - rr, yy), (cx + rr, yy)], fill=(48, 72, 112), width=1)
for k in range(-2, 3):
    rx = R * abs(math.sin(math.radians(k * 30)))
    d.ellipse([cx - rx, cy - R, cx + rx, cy + R], outline=(48, 72, 112), width=1)
# dots
pts = []
for _ in range(34):
    a, rr = rnd.uniform(0, 2 * math.pi), R * math.sqrt(rnd.uniform(0.02, 0.85))
    pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a), rnd.random()))
for x, y, t in sorted(pts, key=lambda p: p[2]):
    col = viridis(t); r = 9 if t < 0.9 else 10
    d.ellipse([x - r + 1, y - r + 3, x + r + 1, y + r + 3], fill=(5, 8, 14))  # shadow
    d.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=(255, 255, 255) if rnd.random() < 0.3 else (10, 14, 22), width=2)
bx, by = cx - 40, cy - 60  # best match
d.ellipse([bx - 13, by - 13, bx + 13, by + 13], fill=viridis(1), outline=(255, 255, 255), width=3)
lab = "Best match · 71"
f = semi(24); tw = d.textlength(lab, font=f) + 26  # room for a drawn star
x0 = bx - tw / 2
d.rounded_rectangle([x0 - 12, by - 62, x0 + tw + 12, by - 24], 6, fill=(26, 20, 8), outline=GOLD, width=2)
sx, sy, so, si = x0 + 9, by - 43, 10, 4.2  # five-point star
star = [(sx + (so if k % 2 == 0 else si) * math.sin(math.pi * k / 5), sy - (so if k % 2 == 0 else si) * math.cos(math.pi * k / 5)) for k in range(10)]
d.polygon(star, fill=GOLD)
d.text((x0 + 26, by - 59), lab, font=f, fill=(255, 230, 166))

# text block
orbit_logo(d, 104, 112, 22, 4)
d.text((146, 88), "Analog Atlas", font=bold(40), fill=TEXT)
d.text((80, 206), "Find Earth's", font=bold(66), fill=TEXT)
d.text((80, 284), "Moon & Mars twins", font=bold(66), fill=ACC)
head_right = 80 + d.textlength("Moon & Mars twins", font=bold(66))
assert head_right < cx - R - 20, f"headline ({head_right:.0f}) runs into globe ({cx - R})"
print(f"globe x {cx - R}..{cx + R}, right margin {W - (cx + R)}px, headline ends {head_right:.0f}")
d.text((82, 398), "Every Earth site scored on terrain, climate and", font=reg(28), fill=MUTED)
d.text((82, 436), "geology against a Moon or Mars landing site.", font=reg(28), fill=MUTED)
tag = "NASA Space Apps Challenge 2026"
f = semi(22); tw = d.textlength(tag, font=f)
d.rounded_rectangle([80, 520, 80 + tw + 28, 560], 6, fill=(23, 33, 54), outline=(60, 86, 130), width=1)
d.text((94, 525), tag, font=f, fill=(220, 232, 255))
d.text((80 + tw + 48, 525), "Built on NASA open data", font=reg(22), fill=MUTED)
img.save(os.path.join(out, "og-image.png"), optimize=True)

# ---------- apple touch icon ----------
S = 180
ic = Image.new("RGB", (S, S), (19, 22, 29))
di = ImageDraw.Draw(ic)
orbit_logo(di, 90, 90, 40, 9)
ic.save(os.path.join(out, "icon-180.png"), optimize=True)
print("ok")
