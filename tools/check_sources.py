from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont

from nexus_config import PRETENDARD_JP_VF, PRETENDARD_VF, REGIONS, REQUIRED_SOURCES


def describe_font(path: Path) -> list[str]:
    font = TTFont(path, lazy=True)
    lines = [f"  upm: {font['head'].unitsPerEm}"]
    if "fvar" in font:
        axes = []
        for axis in font["fvar"].axes:
            axes.append(
                f"{axis.axisTag}={axis.minValue:g}..{axis.maxValue:g} default={axis.defaultValue:g}"
            )
        lines.append("  axes: " + ", ".join(axes))
    else:
        lines.append("  axes: none")
    lines.append(f"  avar: {'yes' if 'avar' in font else 'no'}")
    font.close()
    return lines


def main() -> int:
    missing = [path for path in REQUIRED_SOURCES if not path.exists()]
    if missing:
        print("Missing source files:", file=sys.stderr)
        for path in missing:
            print(f"  {path}", file=sys.stderr)
        print("\nSee sources/README.md for the expected layout.", file=sys.stderr)
        return 1

    print("Source files found.\n")
    print("Latin source:")
    print(f"- {PRETENDARD_VF}")
    print("\n".join(describe_font(PRETENDARD_VF)))
    print(f"- {PRETENDARD_JP_VF}")
    print("\n".join(describe_font(PRETENDARD_JP_VF)))

    print("\nRegional CJK sources:")
    seen: set[Path] = set()
    for region in REGIONS:
        if region.cjk_source_file in seen:
            continue
        seen.add(region.cjk_source_file)
        print(f"- {region.code}: {region.cjk_source_file}")
        print("\n".join(describe_font(region.cjk_source_file)))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
