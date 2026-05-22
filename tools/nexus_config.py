from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "sources"
BUILD = ROOT / "build"
RELEASE = ROOT / "release"

WEIGHT_PREFIX = "W"
WEIGHTS = tuple(range(1, 28))

# Dream Han CJK Sans quadratic interpolation values after removing avar.
CJK_WEIGHT_VALUES = (
    "250",
    "270.4",
    "291.01",
    "311.85",
    "332.94",
    "354.3",
    "375.95",
    "397.91",
    "420.2",
    "442.84",
    "465.85",
    "489.25",
    "513.06",
    "537.3",
    "561.99",
    "587.15",
    "612.8",
    "638.96",
    "665.65",
    "692.89",
    "720.7",
    "749.1",
    "778.11",
    "807.75",
    "838.04",
    "869",
    "900",
)

# Pretendard Std uses its own calibrated weight coordinates. These values are
# intentionally independent from the Source Han Sans design-space coordinates.
LATIN_WEIGHT_VALUES = (
    "89",
    "115.69",
    "142.65",
    "169.92",
    "197.52",
    "225.47",
    "253.81",
    "282.56",
    "311.75",
    "341.39",
    "371.53",
    "401.94",
    "431.87",
    "462.35",
    "493.4",
    "525.05",
    "557.32",
    "590.24",
    "623.83",
    "658.11",
    "693.13",
    "728.89",
    "765.42",
    "802.76",
    "840.93",
    "879.94",
    "919.02",
)

# Public OS/2 weight classes follow Dream Han Sans' quadratic output weights.
# W12/W22 are still marked regular/bold through style-link metadata.
PUBLIC_WEIGHT_CLASSES = (
    250,
    270,
    291,
    312,
    333,
    354,
    376,
    398,
    420,
    443,
    466,
    489,
    513,
    537,
    562,
    587,
    613,
    639,
    666,
    693,
    721,
    749,
    778,
    808,
    838,
    869,
    900,
)

STYLE_LINK_REGULAR = 12
STYLE_LINK_BOLD = 22


@dataclass(frozen=True)
class Region:
    code: str
    english_name: str
    localized_name: str | None
    cjk_source_file: Path


PRETENDARD_VF = SOURCES / "pretendard-std" / "PretendardStdVariable.ttf"
PRETENDARD_JP_VF = SOURCES / "pretendard-jp" / "PretendardJPVariable.ttf"
SOURCE_HAN_SANS_HC_VF = SOURCES / "source-han-sans" / "SourceHanSansHC-VF.ttf"

REGIONS = (
    Region(
        code="SC",
        english_name="Nexus Han Sans SC",
        localized_name="结源黑体 SC",
        cjk_source_file=SOURCES / "source-han-sans" / "SourceHanSansSC-VF.ttf",
    ),
    Region(
        code="TC",
        english_name="Nexus Han Sans TC",
        localized_name="結源黑體 TC",
        cjk_source_file=SOURCES / "source-han-sans" / "SourceHanSansTC-VF.ttf",
    ),
    Region(
        code="HC",
        english_name="Nexus Han Sans HC",
        localized_name="結源黑體 HC",
        cjk_source_file=SOURCE_HAN_SANS_HC_VF,
    ),
    Region(
        code="JP",
        english_name="Nexus Han Sans JP",
        localized_name="結ノ角ゴ JP",
        cjk_source_file=SOURCES / "source-han-sans" / "SourceHanSans-VF.ttf",
    ),
    Region(
        code="KR",
        english_name="Nexus Han Sans KR",
        localized_name="결본고딕 KR",
        cjk_source_file=SOURCES / "source-han-sans" / "SourceHanSansK-VF.ttf",
    ),
)

REQUIRED_SOURCES = tuple(
    dict.fromkeys(
        (
            *(region.cjk_source_file for region in REGIONS),
            PRETENDARD_VF,
            PRETENDARD_JP_VF,
        )
    )
)


def weight_name(weight: int) -> str:
    return f"{WEIGHT_PREFIX}{weight:02d}"


def cjk_weight_value(weight: int) -> str:
    return CJK_WEIGHT_VALUES[weight - 1]


def latin_weight_value(weight: int) -> str:
    return LATIN_WEIGHT_VALUES[weight - 1]


def public_weight_class(weight: int) -> int:
    return PUBLIC_WEIGHT_CLASSES[weight - 1]


def weight_value(weight: int) -> str:
    return cjk_weight_value(weight)
