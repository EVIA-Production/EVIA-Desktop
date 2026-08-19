"""The Taylos mark, rebuilt from geometry measured off the product icon.

Everything below is measured, not styled. Source: icon_liquid.png (600x600,
outer radius R = 231px). Component count is stable across luminance thresholds
80-245 and identical on the website copy, so the structure is real artwork and
not a shadow artifact.

  core blob        disc, r = 0.316 R
  6 FUSED arms     at 31 deg + 60k - neck leaves the core, holds a constant
                   waist (half-width 0.078 R) from 0.40 to 0.60 R, then swells
                   to a round head of r 0.181 R centred at 0.82 R
  6 DETACHED pins  at  1 deg + 60k - free-floating, nothing touches them. Round
                   tail tip at 0.44 R, constant shaft (half-width 0.056 R) to
                   0.65 R, swelling to a round head of r 0.143 R at 0.855 R

The alternation, the constant waist and the ring of gaps ARE the mark. A
uniform 12-spoke star discards all three, which is how the first attempt turned
into an asterisk.
"""
import math
import numpy as np
from PIL import Image

MARK_SPAN = 0.77          # fraction of the canvas the mark occupies
CORE_R    = 0.316

# (radius from centre, half-width) straight off the measurement, out to the
# head centre; the disc at the head supplies the round cap beyond it.
FUSED_PROFILE = [(0.30, 0.085), (0.35, 0.098), (0.40, 0.083), (0.45, 0.078),
                 (0.50, 0.078), (0.55, 0.075), (0.60, 0.083), (0.65, 0.102),
                 (0.70, 0.143), (0.75, 0.169), (0.82, 0.181)]
PIN_PROFILE   = [(0.44, 0.034), (0.50, 0.056), (0.55, 0.056), (0.60, 0.056),
                 (0.65, 0.056), (0.70, 0.069), (0.75, 0.095), (0.80, 0.128),
                 (0.855, 0.143)]
FUSED_ANG0 = math.radians(31.0)
PIN_ANG0   = math.radians(1.0)


def _sweep(mask, gx, gy, t, profile, steps=420):
    rs = np.array([p[0] for p in profile])
    ws = np.array([p[1] for p in profile])
    ux, uy = math.cos(t), math.sin(t)
    for r in np.linspace(rs[0], rs[-1], steps):
        rad = float(np.interp(r, rs, ws))
        mask |= (gx - ux * r) ** 2 + (gy - uy * r) ** 2 <= rad * rad
    return mask


def render(px: int, ss: int = 16) -> Image.Image:
    n = px * ss
    lin = (np.arange(n) + 0.5) / n * 2 - 1
    gx, gy = np.meshgrid(lin, lin)
    gx, gy = gx / MARK_SPAN, gy / MARK_SPAN

    mask = gx ** 2 + gy ** 2 <= CORE_R ** 2
    for k in range(6):
        mask = _sweep(mask, gx, gy, FUSED_ANG0 + k * math.pi / 3, FUSED_PROFILE)
    for k in range(6):
        mask = _sweep(mask, gx, gy, PIN_ANG0 + k * math.pi / 3, PIN_PROFILE)

    img = Image.fromarray((mask * 255).astype(np.uint8), "L").resize((px, px), Image.LANCZOS)
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.putalpha(img)     # black shape + alpha == macOS template image
    return out
