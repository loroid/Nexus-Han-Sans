from __future__ import annotations

import argparse
import concurrent.futures
import re
import shutil
import subprocess
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

from nexus_config import (
    BUILD,
    PRETENDARD_JP_VF,
    PRETENDARD_VF,
    REGIONS,
    WEIGHTS,
    cjk_weight_value,
    latin_weight_value,
    weight_name,
)


def drop_avar(source: Path, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    font = TTFont(source)
    if "avar" in font:
        del font["avar"]
    font.save(target)
    font.close()
    return target


def run_instancer(source: Path, output: Path, wght: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-m",
        "fontTools.varLib.instancer",
        "-o",
        str(output),
        "--remove-overlaps",
        str(source),
        f"wght={wght}",
    ]
    subprocess.run(command, check=True)


def parse_weights(value: str | None) -> tuple[int, ...]:
    if not value:
        return WEIGHTS
    selected: list[int] = []
    for part in re.split(r"[\s,]+", value):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start = int(start_text)
            end = int(end_text)
            selected.extend(range(start, end + 1))
        else:
            selected.append(int(part))
    invalid = [weight for weight in selected if weight not in WEIGHTS]
    if invalid:
        raise ValueError(f"Invalid weight(s): {invalid}")
    return tuple(dict.fromkeys(selected))


def build_jobs(selected_weights: tuple[int, ...]) -> list[tuple[Path, Path, str]]:
    prepared = BUILD / "prepared"
    instances = BUILD / "instances"

    sources = [
        ("pretendard-std/PretendardStd", PRETENDARD_VF, latin_weight_value),
        ("pretendard-jp/PretendardJP", PRETENDARD_JP_VF, latin_weight_value),
    ]
    for region in REGIONS:
        sources.append(
            (
                f"cjk/{region.code}/NexusHanSans{region.code}-CJK",
                region.cjk_source_file,
                cjk_weight_value,
            )
        )

    prepared_sources = []
    for name, source, value_fn in sources:
        prepared_path = prepared / f"{Path(name).name}.noavar.ttf"
        prepared_sources.append((name, drop_avar(source, prepared_path), value_fn))

    jobs = []
    for name, source, value_fn in prepared_sources:
        for weight in selected_weights:
            out = instances / f"{name}-{weight_name(weight)}.ttf"
            jobs.append((source, out, value_fn(weight)))
    return jobs


def main() -> int:
    parser = argparse.ArgumentParser(description="Instantiate Nexus Han Sans upstream variable fonts.")
    parser.add_argument("--jobs", type=int, default=1, help="Maximum parallel instancer jobs.")
    parser.add_argument("--clean", action="store_true", help="Remove build/instances before running.")
    parser.add_argument(
        "--weights",
        help="Comma-separated weight numbers or ranges to instantiate, for example 12 or 1,12,22.",
    )
    args = parser.parse_args()

    if args.clean:
        shutil.rmtree(BUILD / "instances", ignore_errors=True)
        shutil.rmtree(BUILD / "prepared", ignore_errors=True)

    selected_weights = parse_weights(args.weights)
    jobs = build_jobs(selected_weights)
    print(f"Instantiating {len(jobs)} fonts with {args.jobs} parallel job(s).")

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as executor:
        futures = [executor.submit(run_instancer, *job) for job in jobs]
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            future.result()
            if index % 10 == 0 or index == len(futures):
                print(f"  {index}/{len(futures)} done")

    print("Instance fonts written to build/instances.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
