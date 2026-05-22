from __future__ import annotations

import argparse
import math
from pathlib import Path

from fontTools.pens.areaPen import AreaPen
from fontTools.ttLib import TTFont

from nexus_config import CJK_WEIGHT_VALUES, ROOT, WEIGHTS, weight_name


DEFAULT_PRETENDARD_JP = (
    ROOT.parent / "pretendard" / "dist" / "public" / "variable" / "PretendardJPVariable.ttf"
)
DEFAULT_SOURCE = ROOT / "build" / "prepared" / "NexusHanSansJP-CJK.noavar.ttf"
DEFAULT_SAMPLE = "一二三口日田国語漢文永東青海書門開電風愛学新天地人大小中上下左右年月本明朝黒体結源あア"
SOURCE_TO_PRETENDARD_COORD_SCALE = 1.92
SOURCE_TO_PRETENDARD_COVERAGE_SCALE = SOURCE_TO_PRETENDARD_COORD_SCALE * 1000 / 2048


def glyph_coverage(font: TTFont, char: str, weight: float, width_scale: float = 1.0) -> float | None:
    cmap = font.getBestCmap() or {}
    glyph_name = cmap.get(ord(char))
    if not glyph_name:
        return None

    glyph_set = font.getGlyphSet(location={"wght": weight})
    pen = AreaPen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    advance_width = getattr(glyph_set[glyph_name], "width", font["hmtx"].metrics[glyph_name][0])
    units_per_em = font["head"].unitsPerEm
    if advance_width <= 0 or units_per_em <= 0:
        return None
    return abs(pen.value) * width_scale / (advance_width * units_per_em)


def coverage_vector(font: TTFont, sample: str, weight: float, width_scale: float = 1.0) -> list[float]:
    return [
        value
        for char in sample
        if (value := glyph_coverage(font, char, weight, width_scale)) is not None
    ]


def rms_distance(left: list[float], right: list[float]) -> float:
    count = min(len(left), len(right))
    return math.sqrt(sum((left[i] - right[i]) ** 2 for i in range(count)) / count)


def lerp(left: float, right: float, t: float) -> float:
    return left + (right - left) * t


def projection_t(target: list[float], left: list[float], right: list[float]) -> float:
    deltas = [b - a for a, b in zip(left, right)]
    denominator = sum(delta * delta for delta in deltas)
    if denominator == 0:
        return 0.0
    numerator = sum((x - a) * delta for x, a, delta in zip(target, left, deltas))
    return max(0.0, min(1.0, numerator / denominator))


def build_pretendard_curve(font: TTFont, sample: str, step: int) -> list[dict[str, object]]:
    axis = next(axis for axis in font["fvar"].axes if axis.axisTag == "wght")
    weights = list(range(int(axis.minValue), int(axis.maxValue) + 1, step))
    if weights[-1] != int(axis.maxValue):
        weights.append(int(axis.maxValue))
    entries = []
    for weight in weights:
        vector = coverage_vector(font, sample, weight)
        entries.append({"weight": float(weight), "vector": vector})
    return entries


def project_to_pretendard(target: list[float], entries: list[dict[str, object]]) -> dict[str, object]:
    best: dict[str, object] | None = None
    for index in range(len(entries) - 1):
        left = entries[index]
        right = entries[index + 1]
        left_vector = left["vector"]
        right_vector = right["vector"]
        if not isinstance(left_vector, list) or not isinstance(right_vector, list):
            raise TypeError("Pretendard JP vector metadata is malformed")
        t = projection_t(target, left_vector, right_vector)
        projected = [lerp(a, b, t) for a, b in zip(left_vector, right_vector)]
        distance = rms_distance(target, projected)
        weight = lerp(float(left["weight"]), float(right["weight"]), t)
        candidate = {
            "distance": distance,
            "latinWeight": weight,
            "segment": f"{float(left['weight']):g}-{float(right['weight']):g}",
            "t": t,
        }
        if best is None or distance < float(best["distance"]):
            best = candidate
    if best is None:
        raise ValueError("Need at least two Pretendard JP curve entries")
    return best


def format_weight(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Derive Nexus Latin wght coordinates from Pretendard JP's Source Han Sans pairing."
    )
    parser.add_argument("--pretendard-jp", type=Path, default=DEFAULT_PRETENDARD_JP)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--sample", default=DEFAULT_SAMPLE)
    parser.add_argument("--step", type=int, default=5, help="Pretendard JP wght sampling step.")
    args = parser.parse_args()

    if not args.pretendard_jp.exists():
        raise FileNotFoundError(args.pretendard_jp)
    if not args.source.exists():
        raise FileNotFoundError(
            f"{args.source} not found. Run tools/instantiate.py once to create prepared no-avar sources."
        )

    pretendard = TTFont(args.pretendard_jp)
    source = TTFont(args.source)
    try:
        curve = build_pretendard_curve(pretendard, args.sample, args.step)
        print("weight sourceWght latinWeight segment t rms")
        values = []
        for weight, source_weight_text in zip(WEIGHTS, CJK_WEIGHT_VALUES):
            source_weight = float(source_weight_text)
            target = coverage_vector(
                source,
                args.sample,
                source_weight,
                width_scale=SOURCE_TO_PRETENDARD_COVERAGE_SCALE,
            )
            projected = project_to_pretendard(target, curve)
            latin_weight = float(projected["latinWeight"])
            values.append(latin_weight)
            print(
                weight_name(weight),
                format_weight(source_weight),
                format_weight(latin_weight),
                projected["segment"],
                f"{float(projected['t']):.3f}",
                f"{float(projected['distance']):.6f}",
            )

        print("\nLATIN_WEIGHT_VALUES = (")
        for value in values:
            print(f'    "{format_weight(value)}",')
        print(")")
    finally:
        pretendard.close()
        source.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
