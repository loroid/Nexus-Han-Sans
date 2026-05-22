from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any

from nexus_config import ROOT


LOCK_FILE = ROOT / "sources" / "upstream-lock.json"

UPSTREAMS = (
    {
        "id": "source-han-sans",
        "name": "Source Han Sans",
        "repo": "adobe-fonts/source-han-sans",
        "componentPrefix": "Source Han Sans",
        "versionKind": "source-han-sans",
    },
    {
        "id": "pretendard-std",
        "name": "Pretendard Std",
        "repo": "orioncactus/pretendard",
        "componentPrefix": "Pretendard Std",
        "versionKind": "pretendard",
    },
)


def github_json(url: str) -> Any:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Nexus-Han-Sans-upstream-check",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def latest_stable_release(repo: str) -> dict[str, Any]:
    releases = github_json(f"https://api.github.com/repos/{repo}/releases")
    for release in releases:
        if not release.get("draft") and not release.get("prerelease"):
            return release
    raise RuntimeError(f"No stable release found for {repo}")


def parse_version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", value))


def version_from_name_record(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r"\bVersion\s+(\d+(?:\.\d+)*)", value, re.IGNORECASE)
    return match.group(1) if match else None


def source_release_version(release: dict[str, Any]) -> str | None:
    text = f"{release.get('tag_name', '')} {release.get('name', '')}"
    match = re.search(r"(\d+\.\d+)", text)
    return match.group(1) if match else None


def pretendard_font_version_to_release(value: str) -> str:
    parts = value.split(".", 1)
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        return value
    major = int(parts[0])
    fractional = parts[1].ljust(3, "0")
    minor = int(fractional[0])
    patch = int(fractional[1:] or "0")
    return f"{major}.{minor}.{patch}"


def pretendard_release_version(release: dict[str, Any]) -> str | None:
    text = f"{release.get('tag_name', '')} {release.get('name', '')}"
    match = re.search(r"v?(\d+\.\d+\.\d+)", text)
    return match.group(1) if match else None


def current_font_version(lock: dict[str, Any], component_prefix: str) -> str | None:
    for item in lock.get("files", []):
        component = item.get("component", "")
        if not component.startswith(component_prefix):
            continue
        return version_from_name_record(item.get("font", {}).get("version"))
    return None


def current_release_version(lock: dict[str, Any], upstream: dict[str, str]) -> str | None:
    current = current_font_version(lock, upstream["componentPrefix"])
    if not current:
        return None
    if upstream["versionKind"] == "pretendard":
        return pretendard_font_version_to_release(current)
    return current


def latest_release_version(release: dict[str, Any], upstream: dict[str, str]) -> str | None:
    if upstream["versionKind"] == "pretendard":
        return pretendard_release_version(release)
    return source_release_version(release)


def make_summary(rows: list[dict[str, Any]]) -> str:
    lines = [
        "# Upstream Release Check",
        "",
        "| Upstream | Current | Latest | Status |",
        "| --- | --- | --- | --- |",
    ]
    for row in rows:
        status = "Update available" if row["updateAvailable"] else "Current"
        lines.append(
            f"| {row['name']} | {row['currentVersion']} | "
            f"{row['latestVersion']} ({row['latestTag']}) | {status} |"
        )
    if any(row["updateAvailable"] for row in rows):
        lines.extend(
            [
                "",
                "Updates were found. Run the manual build workflow after reviewing upstream changes.",
            ]
        )
    return "\n".join(lines) + "\n"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check GitHub upstream releases against sources/upstream-lock.json.")
    parser.add_argument("--lock", type=Path, default=LOCK_FILE)
    parser.add_argument("--json-output", type=Path)
    parser.add_argument(
        "--no-fail-on-update",
        action="store_true",
        help="Return exit code 0 even when a newer upstream release is found.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.lock.exists():
        print(f"Missing lock file: {args.lock}", file=sys.stderr)
        return 2

    with args.lock.open("r", encoding="utf-8") as file:
        lock = json.load(file)

    rows = []
    for upstream in UPSTREAMS:
        current = current_release_version(lock, upstream)
        if not current:
            raise RuntimeError(f"Could not find current version for {upstream['name']} in {args.lock}")
        release = latest_stable_release(upstream["repo"])
        latest = latest_release_version(release, upstream)
        if not latest:
            raise RuntimeError(f"Could not parse latest release version for {upstream['repo']}")
        update_available = parse_version_tuple(latest) > parse_version_tuple(current)
        rows.append(
            {
                "id": upstream["id"],
                "name": upstream["name"],
                "repo": upstream["repo"],
                "currentVersion": current,
                "latestVersion": latest,
                "latestTag": release.get("tag_name"),
                "latestUrl": release.get("html_url"),
                "updateAvailable": update_available,
            }
        )

    summary = make_summary(rows)
    print(summary, end="")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as file:
            file.write(summary)

    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        with args.json_output.open("w", encoding="utf-8", newline="\n") as file:
            json.dump(
                {
                    "schemaVersion": 1,
                    "hasUpdates": any(row["updateAvailable"] for row in rows),
                    "upstreams": rows,
                },
                file,
                indent=2,
            )
            file.write("\n")

    if any(row["updateAvailable"] for row in rows) and not args.no_fail_on_update:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
