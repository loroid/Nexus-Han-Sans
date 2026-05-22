from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

from nexus_config import RELEASE


REGION_ORDER = ("SC", "TC", "HC", "JP", "KR")


def write_zip(output: Path, files: list[Path]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, path.name)


def package_ttf(ttf_dir: Path, zip_dir: Path) -> list[Path]:
    outputs: list[Path] = []
    for region in REGION_ORDER:
        files = sorted(ttf_dir.glob(f"NexusHanSans{region}-W*.ttf"))
        if not files:
            continue
        output = zip_dir / f"NexusHanSans{region}-TTF.zip"
        write_zip(output, files)
        outputs.append(output)
    return outputs


def package_ttc(ttc_dir: Path, zip_dir: Path) -> list[Path]:
    files = sorted(ttc_dir.glob("NexusHanSans-W*.ttc"))
    if not files:
        return []
    output = zip_dir / "NexusHanSans-TTC.zip"
    write_zip(output, files)
    return [output]


def package_super_ttc(super_ttc_dir: Path, zip_dir: Path) -> list[Path]:
    files = sorted(super_ttc_dir.glob("NexusHanSans-Super*.ttc"))
    if not files:
        return []
    output = zip_dir / "NexusHanSans-SuperTTC.zip"
    write_zip(output, files)
    return [output]


def main() -> int:
    parser = argparse.ArgumentParser(description="Package Nexus Han Sans release files.")
    parser.add_argument("--ttf-dir", default=str(RELEASE / "TTF"))
    parser.add_argument("--ttc-dir", default=str(RELEASE / "TTC"))
    parser.add_argument("--super-ttc-dir", default=str(RELEASE / "SuperTTC"))
    parser.add_argument("--zip-dir", default=str(RELEASE / "ZIP"))
    args = parser.parse_args()

    outputs = [
        *package_ttf(Path(args.ttf_dir), Path(args.zip_dir)),
        *package_ttc(Path(args.ttc_dir), Path(args.zip_dir)),
        *package_super_ttc(Path(args.super_ttc_dir), Path(args.zip_dir)),
    ]
    for output in outputs:
        print(f"built {output}")
    if not outputs:
        print("No release files found to package.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
