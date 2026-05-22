from __future__ import annotations

import argparse
import html
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

from nexus_config import RELEASE, ROOT, WEIGHTS, weight_name


DEFAULT_TEXT = "结源黑体 / Nexus Han Sans"
DEFAULT_TITLE = "结源黑体字重测试"
DEFAULT_OUTPUT = Path("image/svg/weight.svg")


def format_number(value: float) -> str:
    rounded = round(value, 3)
    if rounded == int(rounded):
        return str(int(rounded))
    return f"{rounded:.3f}".rstrip("0").rstrip(".")


def glyph_name_for_char(font: TTFont, char: str) -> str:
    cmap = font.getBestCmap()
    glyph_name = cmap.get(ord(char))
    if not glyph_name:
        raise ValueError(f"Missing glyph for U+{ord(char):04X} {char!r} in {font.reader.file.name}")
    return glyph_name


def text_advance(font: TTFont, text: str, font_size: float) -> float:
    scale = font_size / font["head"].unitsPerEm
    advance = 0.0
    for char in text:
        glyph_name = glyph_name_for_char(font, char)
        advance += font["hmtx"].metrics[glyph_name][0] * scale
    return advance


def text_path(font: TTFont, text: str, x: float, baseline: float, font_size: float) -> str:
    scale = font_size / font["head"].unitsPerEm
    glyph_set = font.getGlyphSet()
    pen = SVGPathPen(glyph_set, ntos=format_number)
    cursor = x
    for char in text:
        glyph_name = glyph_name_for_char(font, char)
        glyph_pen = TransformPen(pen, (scale, 0, 0, -scale, cursor, baseline))
        glyph_set[glyph_name].draw(glyph_pen)
        cursor += font["hmtx"].metrics[glyph_name][0] * scale
    return pen.getCommands()


def render_preview(output: Path, text: str, title: str) -> None:
    width = 1115
    height = 2000
    row_font_size = 47
    title_font_size = 21
    label_font_size = 21
    first_baseline = 112
    row_step = 68

    output.parent.mkdir(parents=True, exist_ok=True)

    title_font = TTFont(RELEASE / "TTF" / f"NexusHanSansSC-{weight_name(12)}.ttf")
    title_path = text_path(title_font, title, 16, 40, title_font_size)

    label = text
    label_width = text_advance(title_font, label, label_font_size)
    label_path = text_path(
        title_font,
        label,
        width - 18 - label_width,
        height - 24,
        label_font_size,
    )

    paths = [
        f'<path d="{title_path}" fill="#ffffff"/>',
    ]
    for index, weight in enumerate(WEIGHTS):
        font = TTFont(RELEASE / "TTF" / f"NexusHanSansSC-{weight_name(weight)}.ttf")
        line_width = text_advance(font, text, row_font_size)
        x = (width - line_width) / 2
        baseline = first_baseline + index * row_step
        path = text_path(font, text, x, baseline, row_font_size)
        paths.append(f'<path d="{path}" fill="#ffffff"/>')
        font.close()
    paths.append(f'<path d="{label_path}" fill="#ffffff"/>')
    title_font.close()

    svg = "\n".join(
        [
            '<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
            f'role="img" aria-label="{html.escape(title)}">',
            '<rect width="100%" height="100%" fill="#000000"/>',
            *paths,
            "</svg>",
            "",
        ]
    )
    output.write_text(svg, encoding="utf-8", newline="\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the README weight preview SVG.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--text", default=DEFAULT_TEXT)
    parser.add_argument("--title", default=DEFAULT_TITLE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = args.output if args.output.is_absolute() else ROOT / args.output
    render_preview(output, args.text, args.title)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
