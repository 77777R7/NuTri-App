from __future__ import annotations

from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "images"
BG = (242, 242, 242, 255)
SHADOW = (0, 0, 0, 220)
LEFT_TOP = (20, 135, 220, 255)
LEFT_BOTTOM = (246, 214, 33, 255)
MID_TOP = (236, 236, 236, 255)
MID_BOTTOM = (221, 221, 221, 255)
RIGHT_TOP = (197, 180, 228, 255)
RIGHT_BOTTOM = (180, 219, 155, 255)
HIGHLIGHT = (255, 255, 255, 210)
MONO = (20, 20, 20, 255)
FONT_PATH = Path("/System/Library/Fonts/Supplemental/Arial Black.ttf")


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def add_receipt_texture(canvas: Image.Image, x: int, y: int, w: int, h: int, mask: Image.Image) -> None:
    texture = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(texture)
    rng = random.Random(23)
    font = ImageFont.load_default()

    for row in range(22):
        y0 = y + 24 + row * 14 + rng.randint(-2, 2)
        x0 = x + 20 + rng.randint(-6, 6)
        draw.text((x0, y0), f"{rng.randint(10, 99)} {rng.randint(100, 999)} {rng.randint(10, 99)}", fill=(120, 120, 120, 118), font=font)

    clipped = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    clipped.paste(texture, mask=mask)
    canvas.alpha_composite(clipped)


def draw_capsule(
    canvas: Image.Image,
    x: int,
    y: int,
    w: int,
    h: int,
    top_color: tuple[int, int, int, int],
    bottom_color: tuple[int, int, int, int],
    seam_fill: tuple[int, int, int, int],
    shadow_offset: tuple[int, int],
    *,
    textured: bool = False,
    monochrome: bool = False,
) -> None:
    radius = w // 2
    mask = rounded_mask((w, h), radius)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow_layer).rounded_rectangle((0, 0, w, h), radius=radius, fill=SHADOW if not monochrome else (0, 0, 0, 0))
    shadow.alpha_composite(shadow_layer, (x + shadow_offset[0], y + shadow_offset[1]))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=10))
    canvas.alpha_composite(shadow)

    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    pill = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(pill)
    if monochrome:
        draw.rounded_rectangle((0, 0, w, h), radius=radius, fill=MONO)
    else:
        draw.rectangle((0, 0, w, h // 2), fill=top_color)
        draw.rectangle((0, h // 2, w, h), fill=bottom_color)
    layer.alpha_composite(pill, (x, y))
    full_mask = Image.new("L", canvas.size, 0)
    full_mask.paste(mask, (x, y))
    clipped = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    clipped.paste(layer, mask=full_mask)
    canvas.alpha_composite(clipped)

    if textured and not monochrome:
        add_receipt_texture(canvas, x, y, w, h, full_mask)

    seam_top = y + h // 2 - max(8, h // 35)
    seam_bottom = y + h // 2 + max(8, h // 35)
    seam_mask = Image.new("L", canvas.size, 0)
    seam_mask.paste(mask, (x, y))
    seam_rect = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(seam_rect).rectangle((x, seam_top, x + w, seam_bottom), fill=255)
    combined = Image.new("L", canvas.size, 0)
    combined.paste(seam_rect, mask=seam_mask)
    canvas.paste(seam_fill, (0, 0), combined)

    if not monochrome:
        highlight_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        highlight = ImageDraw.Draw(highlight_layer)
        bar_w = max(14, w // 8)
        bar_h = max(68, h // 4)
        top_bar = (x + w // 5, y + h // 7, x + w // 5 + bar_w, y + h // 7 + bar_h)
        bottom_bar = (x + w // 5, y + (h * 4) // 7, x + w // 5 + bar_w, y + (h * 4) // 7 + bar_h)
        highlight.rounded_rectangle(top_bar, radius=bar_w // 2, fill=HIGHLIGHT)
        highlight.rounded_rectangle(bottom_bar, radius=bar_w // 2, fill=HIGHLIGHT)
        canvas.alpha_composite(highlight_layer)


def draw_mark(size: int, *, with_text: bool = False, transparent_background: bool = False, monochrome: bool = False) -> Image.Image:
    background = (0, 0, 0, 0) if transparent_background else BG
    image = Image.new("RGBA", (size, size), background)

    pill_w = round(size * (0.19 if not with_text else 0.16))
    pill_h = round(size * (0.4 if not with_text else 0.33))
    gap = round(size * 0.03)
    total_w = pill_w * 3 + gap * 2
    x0 = (size - total_w) // 2
    y0 = round(size * (0.28 if not with_text else 0.2))
    shadow_offset = (-round(size * 0.018), round(size * 0.018))
    seam_fill = (0, 0, 0, 0) if transparent_background else BG

    draw_capsule(image, x0, y0, pill_w, pill_h, LEFT_TOP, LEFT_BOTTOM, seam_fill, shadow_offset, monochrome=monochrome)
    draw_capsule(
        image,
        x0 + pill_w + gap,
        y0,
        pill_w,
        pill_h,
        MID_TOP,
        MID_BOTTOM,
        seam_fill,
        shadow_offset,
        textured=not monochrome,
        monochrome=monochrome,
    )
    draw_capsule(
        image,
        x0 + 2 * (pill_w + gap),
        y0,
        pill_w,
        pill_h,
        RIGHT_TOP,
        RIGHT_BOTTOM,
        seam_fill,
        shadow_offset,
        monochrome=monochrome,
    )

    if with_text:
        draw = ImageDraw.Draw(image)
        font_size = round(size * 0.16)
        font = ImageFont.truetype(str(FONT_PATH), font_size)
        text = "NuTri"
        bbox = draw.textbbox((0, 0), text, font=font)
        text_x = (size - (bbox[2] - bbox[0])) // 2
        text_y = round(size * 0.68)
        draw.text((text_x, text_y), text, fill=(0, 0, 0, 255), font=font)

    return image


def draw_background(size: int) -> Image.Image:
    bg = Image.new("RGBA", (size, size), BG)
    center = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    overlay = ImageDraw.Draw(center)
    padding = round(size * 0.14)
    overlay.ellipse((padding, padding, size - padding, size - padding), fill=(255, 255, 255, 80))
    center = center.filter(ImageFilter.GaussianBlur(radius=size // 9))
    bg.alpha_composite(center)
    return bg


def save(image: Image.Image, name: str) -> None:
    image.save(ASSETS / name)


def main() -> None:
    save(draw_mark(1024), "icon.png")
    save(draw_mark(1024, with_text=True), "splash-icon.png")
    save(draw_mark(512, transparent_background=True), "android-icon-foreground.png")
    save(draw_background(512), "android-icon-background.png")
    save(draw_mark(432, transparent_background=True, monochrome=True), "android-icon-monochrome.png")
    save(draw_mark(48), "favicon.png")


if __name__ == "__main__":
    main()
