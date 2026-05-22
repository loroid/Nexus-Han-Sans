# Source Files

Place upstream source fonts in this directory before building.

Expected layout:

```text
sources/
  source-han-sans/
    SourceHanSans-VF.ttf
    SourceHanSansSC-VF.ttf
    SourceHanSansTC-VF.ttf
    SourceHanSansHC-VF.ttf
    SourceHanSansK-VF.ttf
  pretendard-std/
    PretendardStdVariable.ttf
  pretendard-jp/
    PretendardJPVariable.ttf
```

Upstream sources:

* Source Han Sans Variable fonts: <https://github.com/adobe-fonts/source-han-sans>
* Pretendard Std and Pretendard JP Variable fonts: <https://github.com/orioncactus/pretendard>

This repository intentionally does not include these large upstream font files.
Download them from the upstream projects, place them in the layout shown above,
and then run:

```bash
python3 tools/check_sources.py
```

For maintainers who keep compatible upstream checkouts next to this repository,
`tools/sync_upstreams.py` can copy Source Han Sans and Pretendard Std files,
compare SHA256 hashes, write `sources/upstream-lock.json`, and run the same
source check:

```bash
python3 tools/sync_upstreams.py
```

The legacy entry point `python3 tools/import_sources.py` is kept as a
compatibility wrapper for the same sync workflow.

On GitHub Actions, `tools/download_upstreams.py` downloads the required release
assets from the upstream projects, including Pretendard JP from the Pretendard
release assets, and writes the same lock file for the build job.
