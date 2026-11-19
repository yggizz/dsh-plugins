"""Render the suite icon to the 180x180 PNG the plugin market requires.

The market's icon rule accepts only a 180x180 PNG for `assets/icon-180.png`
(SVG is fine inside the package, not as the entry icon). No SVG rasterizer is
installed, so this redraws the same geometry with Pillow at 180px.
"""
from PIL import Image, ImageDraw

SIZE = 180
SCALE = SIZE / 64  # the SVG viewBox is 64x64
BLUE = (63, 111, 216)
OUTLINE = 3.2


def px(value: float) -> float:
    return value * SCALE


image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

# Outer rounded frame.
draw.rounded_rectangle(
    [px(7), px(9), px(57), px(55)],
    radius=px(7),
    outline=BLUE,
    width=max(1, round(px(OUTLINE))),
)

# Six switch pills: left column lit, right column mixed.
pills = [
    (14, 17, 28, 25, 1.0),
    (36, 17, 50, 25, 0.35),
    (14, 28, 28, 36, 1.0),
    (36, 28, 50, 36, 0.35),
    (14, 39, 28, 47, 0.35),
    (36, 39, 50, 47, 1.0),
]
for x0, y0, x1, y1, alpha in pills:
    fill = BLUE + (round(255 * alpha),)
    draw.rounded_rectangle(
        [px(x0), px(y0), px(x1), px(y1)],
        radius=px(4),
        fill=fill,
    )

out = r"D:\dsh-workspace\plugin\market-upload\dsh-plugins\packages\dsh-plugin-suite\assets\icon-180.png"
image.save(out, "PNG")
print("wrote", out, image.size)
