from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fontTools.ttLib import TTFont

from nexus_config import ROOT, SOURCES


PROJECTS_ROOT = ROOT.parent
LOCK_FILE = SOURCES / "upstream-lock.json"


@dataclass(frozen=True)
class UpstreamFile:
    component: str
    source: Path
    target: Path


def default_upstream_files(projects_root: Path) -> tuple[UpstreamFile, ...]:
    source_han = projects_root / "dream-han-cjk" / "source" / "source-han-sans"
    pretendard = (
        projects_root
        / "pretendard"
        / "packages"
        / "pretendard-std"
        / "dist"
        / "public"
        / "variable"
    )
    return (
        UpstreamFile(
            "Source Han Sans JP",
            source_han / "SourceHanSans-VF.ttf",
            SOURCES / "source-han-sans" / "SourceHanSans-VF.ttf",
        ),
        UpstreamFile(
            "Source Han Sans SC",
            source_han / "SourceHanSansSC-VF.ttf",
            SOURCES / "source-han-sans" / "SourceHanSansSC-VF.ttf",
        ),
        UpstreamFile(
            "Source Han Sans TC",
            source_han / "SourceHanSansTC-VF.ttf",
            SOURCES / "source-han-sans" / "SourceHanSansTC-VF.ttf",
        ),
        UpstreamFile(
            "Source Han Sans HC",
            source_han / "SourceHanSansHC-VF.ttf",
            SOURCES / "source-han-sans" / "SourceHanSansHC-VF.ttf",
        ),
        UpstreamFile(
            "Source Han Sans KR",
            source_han / "SourceHanSansK-VF.ttf",
            SOURCES / "source-han-sans" / "SourceHanSansK-VF.ttf",
        ),
        UpstreamFile(
            "Pretendard Std",
            pretendard / "PretendardStdVariable.ttf",
            SOURCES / "pretendard-std" / "PretendardStdVariable.ttf",
        ),
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative_path(path: Path) -> str:
    return Path(os.path.relpath(path, ROOT)).as_posix()


def read_name(font: TTFont, name_id: int) -> str | None:
    name = font["name"].getDebugName(name_id)
    return name if name else None


def describe_font(path: Path) -> dict[str, Any]:
    font = TTFont(path, lazy=True)
    try:
        axes = []
        if "fvar" in font:
            for axis in font["fvar"].axes:
                axes.append(
                    {
                        "tag": axis.axisTag,
                        "min": axis.minValue,
                        "default": axis.defaultValue,
                        "max": axis.maxValue,
                    }
                )
        return {
            "family": read_name(font, 1),
            "subfamily": read_name(font, 2),
            "fullName": read_name(font, 4),
            "version": read_name(font, 5),
            "unitsPerEm": font["head"].unitsPerEm,
            "fontRevision": font["head"].fontRevision,
            "axes": axes,
            "hasAvar": "avar" in font,
        }
    finally:
        font.close()


def load_lock() -> dict[str, Any] | None:
    if not LOCK_FILE.exists():
        return None
    with LOCK_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)


def comparable_lock(lock: dict[str, Any]) -> dict[str, Any]:
    lock = dict(lock)
    lock.pop("syncedAt", None)
    return lock


def write_lock(entries: list[dict[str, Any]]) -> bool:
    next_lock = {
        "schemaVersion": 1,
        "syncedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "files": entries,
    }
    current = load_lock()
    if current and comparable_lock(current) == comparable_lock(next_lock):
        print(f"lock  {relative_path(LOCK_FILE)} unchanged")
        return False
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_FILE.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(next_lock, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(f"lock  {relative_path(LOCK_FILE)}")
    return True


def copy_if_changed(item: UpstreamFile, dry_run: bool) -> bool:
    source_hash = sha256_file(item.source)
    target_hash = sha256_file(item.target) if item.target.exists() else None
    if source_hash == target_hash:
        print(f"skip  {relative_path(item.target)}")
        return False
    if dry_run:
        action = "update" if item.target.exists() else "copy"
        print(f"{action} {relative_path(item.source)} -> {relative_path(item.target)}")
        return True
    item.target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(item.source, item.target)
    action = "update" if target_hash else "copy"
    print(f"{action} {relative_path(item.source)} -> {relative_path(item.target)}")
    return True


def build_lock_entries(items: tuple[UpstreamFile, ...]) -> list[dict[str, Any]]:
    entries = []
    for item in items:
        entries.append(
            {
                "component": item.component,
                "source": relative_path(item.source),
                "target": relative_path(item.target),
                "size": item.target.stat().st_size,
                "sha256": sha256_file(item.target),
                "font": describe_font(item.target),
            }
        )
    return entries


def run_check_sources() -> int:
    return subprocess.run([sys.executable, "-B", "tools/check_sources.py"], cwd=ROOT).returncode


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchronize local upstream font files into sources/ and write upstream-lock.json."
    )
    parser.add_argument(
        "--projects-root",
        type=Path,
        default=PROJECTS_ROOT,
        help="Directory containing sibling upstream repositories. Defaults to the parent of this project.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show which files would change without copying or writing the lock file.",
    )
    parser.add_argument(
        "--no-check",
        action="store_true",
        help="Do not run tools/check_sources.py after synchronization.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    projects_root = args.projects_root.resolve()
    items = default_upstream_files(projects_root)

    missing = [item.source for item in items if not item.source.exists()]
    if missing:
        print("Missing local upstream files:", file=sys.stderr)
        for source in missing:
            print(f"  {source}", file=sys.stderr)
        return 1

    changed = False
    for item in items:
        changed = copy_if_changed(item, args.dry_run) or changed

    if args.dry_run:
        print("\nDry run complete. No files were copied.")
        return 0 if changed else 0

    entries = build_lock_entries(items)
    lock_changed = write_lock(entries)

    if args.no_check:
        return 0

    print("")
    sys.stdout.flush()
    check_code = run_check_sources()
    if check_code != 0:
        return check_code

    if changed or lock_changed:
        print("\nUpstream sources changed. Rebuild release outputs before publishing.")
    else:
        print("\nUpstream sources are already current.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
