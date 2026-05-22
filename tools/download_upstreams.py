from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from nexus_config import SOURCES
from sync_upstreams import LOCK_FILE, describe_font, relative_path, sha256_file, write_lock


SOURCE_HAN_SANS_REPO = "adobe-fonts/source-han-sans"
SOURCE_HAN_SANS_ASSET = "02_SourceHanSans-VF.zip"
PRETENDARD_REPO = "orioncactus/pretendard"

SOURCE_HAN_SANS_TARGETS = (
    ("Source Han Sans JP", "SourceHanSans-VF.ttf", SOURCES / "source-han-sans" / "SourceHanSans-VF.ttf"),
    ("Source Han Sans SC", "SourceHanSansSC-VF.ttf", SOURCES / "source-han-sans" / "SourceHanSansSC-VF.ttf"),
    ("Source Han Sans TC", "SourceHanSansTC-VF.ttf", SOURCES / "source-han-sans" / "SourceHanSansTC-VF.ttf"),
    ("Source Han Sans HC", "SourceHanSansHC-VF.ttf", SOURCES / "source-han-sans" / "SourceHanSansHC-VF.ttf"),
    ("Source Han Sans KR", "SourceHanSansK-VF.ttf", SOURCES / "source-han-sans" / "SourceHanSansK-VF.ttf"),
)

PRETENDARD_TARGETS = (
    ("Pretendard Std", "PretendardStdVariable.ttf", SOURCES / "pretendard-std" / "PretendardStdVariable.ttf"),
)

PRETENDARD_JP_TARGETS = (
    ("Pretendard JP", "PretendardJPVariable.ttf", SOURCES / "pretendard-jp" / "PretendardJPVariable.ttf"),
)


def github_json(url: str) -> Any:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Nexus-Han-Sans-upstream-download",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def release_by_tag(repo: str, tag: str) -> dict[str, Any]:
    if tag == "latest":
        releases = github_json(f"https://api.github.com/repos/{repo}/releases")
        for release in releases:
            if not release.get("draft") and not release.get("prerelease"):
                return release
        raise RuntimeError(f"No stable release found for {repo}")
    quoted = urllib.parse.quote(tag, safe="")
    return github_json(f"https://api.github.com/repos/{repo}/releases/tags/{quoted}")


def find_asset(release: dict[str, Any], exact_name: str | None = None, prefix: str | None = None) -> dict[str, Any]:
    assets = release.get("assets", [])
    for asset in assets:
        name = asset.get("name", "")
        if exact_name and name == exact_name:
            return asset
        if prefix and name.startswith(prefix) and name.endswith(".zip"):
            return asset
    wanted = exact_name or f"{prefix}*.zip"
    available = ", ".join(asset.get("name", "") for asset in assets)
    raise RuntimeError(f"Could not find asset {wanted}. Available assets: {available}")


def download_asset(asset: dict[str, Any], output: Path) -> None:
    headers = {"User-Agent": "Nexus-Han-Sans-upstream-download"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(asset["browser_download_url"], headers=headers)
    print(f"download {asset['name']}")
    with urllib.request.urlopen(request, timeout=120) as response, output.open("wb") as file:
        shutil.copyfileobj(response, file)


def zip_member_name(info: zipfile.ZipInfo) -> str:
    return Path(info.filename.replace("\\", "/")).name


def extract_targets(
    archive: Path,
    targets: tuple[tuple[str, str, Path], ...],
    source_label_prefix: str,
) -> list[dict[str, Any]]:
    entries = []
    with zipfile.ZipFile(archive) as zip_file:
        infos = [info for info in zip_file.infolist() if not info.is_dir()]
        for component, basename, target in targets:
            matches = [info for info in infos if zip_member_name(info) == basename]
            if not matches:
                raise RuntimeError(f"{archive.name} does not contain {basename}")
            info = sorted(matches, key=lambda item: len(item.filename))[0]
            target.parent.mkdir(parents=True, exist_ok=True)
            with zip_file.open(info) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            print(f"extract {basename} -> {relative_path(target)}")
            entries.append(
                {
                    "component": component,
                    "source": f"{source_label_prefix}#{info.filename}",
                    "target": relative_path(target),
                    "size": target.stat().st_size,
                    "sha256": sha256_file(target),
                    "font": describe_font(target),
                }
            )
    return entries


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download upstream source fonts from GitHub releases.")
    parser.add_argument("--source-han-sans-release", default="latest")
    parser.add_argument("--pretendard-release", default="latest")
    parser.add_argument("--no-lock", action="store_true", help=f"Do not write {relative_path(LOCK_FILE)}.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    with tempfile.TemporaryDirectory(prefix="nexus-upstreams-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)

        source_release = release_by_tag(SOURCE_HAN_SANS_REPO, args.source_han_sans_release)
        source_asset = find_asset(source_release, exact_name=SOURCE_HAN_SANS_ASSET)
        source_archive = temp_dir / source_asset["name"]
        download_asset(source_asset, source_archive)
        entries = extract_targets(
            source_archive,
            SOURCE_HAN_SANS_TARGETS,
            f"github:{SOURCE_HAN_SANS_REPO}@{source_release['tag_name']}/{source_asset['name']}",
        )

        pretendard_release = release_by_tag(PRETENDARD_REPO, args.pretendard_release)
        pretendard_asset = find_asset(pretendard_release, prefix="PretendardStd-")
        pretendard_archive = temp_dir / pretendard_asset["name"]
        download_asset(pretendard_asset, pretendard_archive)
        entries.extend(
            extract_targets(
                pretendard_archive,
                PRETENDARD_TARGETS,
                f"github:{PRETENDARD_REPO}@{pretendard_release['tag_name']}/{pretendard_asset['name']}",
            )
        )

        pretendard_jp_asset = find_asset(pretendard_release, prefix="PretendardJP-")
        pretendard_jp_archive = temp_dir / pretendard_jp_asset["name"]
        download_asset(pretendard_jp_asset, pretendard_jp_archive)
        entries.extend(
            extract_targets(
                pretendard_jp_archive,
                PRETENDARD_JP_TARGETS,
                f"github:{PRETENDARD_REPO}@{pretendard_release['tag_name']}/{pretendard_jp_asset['name']}",
            )
        )

    if not args.no_lock:
        write_lock(entries)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
