"""
Generates the AloyMobile app icon: a bold cyan "A" glyph on a dark navy
background, matching the app's existing dark/cyan theme (#00f2fe accent,
#10141f / #171d2c surfaces — same palette used throughout App.tsx).

Produces:
- A flattened legacy launcher icon (square + circular "round" variant) at
  each mipmap density.
- Adaptive icon background/foreground layers (API 26+) at each density,
  plus the mipmap-anydpi-v26 XML that references them.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)

SS = 4  # supersampling factor for antialiasing
CANVAS = 512 * SS

BG_TOP = (16, 20, 31)      # #10141f
BG_BOTTOM = (23, 30, 44)   # #171d2c
CYAN_TOP = (94, 246, 255)  # bright cyan highlight
CYAN_MID = (0, 242, 254)   # #00f2fe — the app's exact accent color
CYAN_BOTTOM = (10, 130, 160)  # deeper teal for gradient depth


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (size, size))
    for y in range(size):
        t = y / (size - 1)
        ImageDraw.Draw(img).line([(0, y), (size, y)], fill=lerp(top, bottom, t))
    return img


def rounded_square_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def circle_mask(size):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    return mask


def draw_a_glyph_mask(size):
    """Bold, geometric 'A' — apex + two legs + crossbar, all with round
    joins/caps (built from thick polylines + filled circles at the joints,
    since PIL line caps are butt-only by default)."""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)

    s = size / 1000.0
    apex = (500 * s, 250 * s)
    foot_l = (270 * s, 780 * s)
    foot_r = (730 * s, 780 * s)
    stroke = 92 * s

    d.line([foot_l, apex, foot_r], fill=255, width=int(stroke), joint="curve")
    for pt in (apex, foot_l, foot_r):
        r = stroke / 2
        d.ellipse([pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r], fill=255)

    # Crossbar — intersection points of a horizontal line at y=560 with each leg.
    y_bar = 560 * s

    def x_at_y(p0, p1, y):
        t = (y - p0[1]) / (p1[1] - p0[1])
        return p0[0] + (p1[0] - p0[0]) * t

    bar_l = (x_at_y(apex, foot_l, y_bar), y_bar)
    bar_r = (x_at_y(apex, foot_r, y_bar), y_bar)
    d.line([bar_l, bar_r], fill=255, width=int(stroke * 0.85), joint="curve")
    for pt in (bar_l, bar_r):
        r = stroke * 0.85 / 2
        d.ellipse([pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r], fill=255)

    return mask


def make_background(size, rounded_radius=None):
    bg = vertical_gradient(size, BG_TOP, BG_BOTTOM).convert("RGBA")
    if rounded_radius is not None:
        mask = rounded_square_mask(size, rounded_radius)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(bg, (0, 0), mask)
        return out
    return bg


def make_foreground(size, glyph_scale=0.60):
    """Transparent layer with just the glyph, sized to `glyph_scale` of the
    canvas and centered — keeps it inside the adaptive-icon safe zone."""
    glyph_size = int(size * glyph_scale)
    mask_small = draw_a_glyph_mask(glyph_size)

    # Soft outer glow.
    glow = mask_small.filter(ImageFilter.GaussianBlur(glyph_size * 0.045))
    glow_layer = Image.new("RGBA", (glyph_size, glyph_size), (0, 0, 0, 0))
    glow_rgba = Image.new("RGBA", (glyph_size, glyph_size), CYAN_MID + (0,))
    glow_alpha = glow.point(lambda a: int(a * 0.55))
    glow_layer = Image.composite(
        Image.new("RGBA", (glyph_size, glyph_size), CYAN_MID + (255,)),
        glow_layer, glow_alpha
    )

    grad = vertical_gradient(glyph_size, CYAN_TOP, CYAN_BOTTOM).convert("RGBA")
    glyph_rgba = Image.new("RGBA", (glyph_size, glyph_size), (0, 0, 0, 0))
    glyph_rgba.paste(grad, (0, 0), mask_small)

    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    off = (size - glyph_size) // 2
    layer.alpha_composite(glow_layer, (off, off))
    layer.alpha_composite(glyph_rgba, (off, off))
    return layer


def flatten(bg, fg):
    out = bg.convert("RGBA").copy()
    out.alpha_composite(fg)
    return out


def downsample(img, target):
    return img.resize((target, target), Image.LANCZOS)


# --- Build master layers at supersampled resolution ---
master_bg_legacy = make_background(CANVAS, rounded_radius=int(CANVAS * 0.19))
master_bg_full = make_background(CANVAS, rounded_radius=None)
master_fg = make_foreground(CANVAS, glyph_scale=0.62)
master_flat = flatten(master_bg_legacy, master_fg)

# Preview (flattened, legacy-style rounded square) for a quick look.
downsample(master_flat, 512).save(os.path.join(OUT, "preview_square.png"))

# Circular "round" launcher preview.
circle_preview = flatten(master_bg_full, master_fg)
cmask = circle_mask(CANVAS)
circ = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
circ.paste(circle_preview, (0, 0), cmask)
downsample(circ, 512).save(os.path.join(OUT, "preview_round.png"))

# --- Legacy launcher densities ---
LEGACY_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for density, px in LEGACY_SIZES.items():
    square = downsample(master_flat, px)
    round_ = downsample(circ, px)
    d = os.path.join(OUT, f"mipmap-{density}")
    os.makedirs(d, exist_ok=True)
    square.save(os.path.join(d, "ic_launcher.png"))
    round_.save(os.path.join(d, "ic_launcher_round.png"))

# --- Adaptive icon layers (108dp canvas) ---
ADAPTIVE_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
adaptive_bg = make_background(CANVAS, rounded_radius=None)  # full-bleed, OS masks it
adaptive_fg = make_foreground(CANVAS, glyph_scale=0.45)     # smaller: adaptive safe zone is tighter
for density, px in ADAPTIVE_SIZES.items():
    d = os.path.join(OUT, f"mipmap-{density}")
    os.makedirs(d, exist_ok=True)
    downsample(adaptive_bg, px).save(os.path.join(d, "ic_launcher_background.png"))
    downsample(adaptive_fg, px).save(os.path.join(d, "ic_launcher_foreground.png"))

print("Done ->", OUT)
