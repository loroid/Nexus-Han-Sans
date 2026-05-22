#!/usr/bin/env bash
set -euo pipefail

script_file_name="build_fonts.sh"
platform="${1:-}"
maximum_parallels="${2:-12}"
weights="${3:-1-27}"

print_usage_and_exit() {
    echo "Usage: ${script_file_name} <platform: wsl | linux | mac> [maximum parallel jobs=12] [weights]"
    exit 1
}

is_number() {
    [[ "$1" =~ ^[0-9]+$ ]]
}

if [[ "$platform" != "wsl" && "$platform" != "linux" && "$platform" != "mac" ]]; then
    print_usage_and_exit
fi

if ! is_number "$maximum_parallels"; then
    print_usage_and_exit
fi

cd "$(dirname "$0")/.."

python_bin="${PYTHON:-python3}"
if [[ -x ".venv/bin/python" ]]; then
    python_bin=".venv/bin/python"
fi

node_bin="${NODE:-node}"
if ! command -v "${node_bin}" >/dev/null 2>&1; then
    echo "Node.js is required inside this WSL/Linux environment for the build."
    echo "Install Linux Node.js, or run script/build_fonts.ps1 from Windows PowerShell."
    exit 1
fi

echo "Set platform to ${platform}"
echo "Set maximum parallel jobs to ${maximum_parallels}"
echo "Set weights to ${weights}"
echo "Using Python: ${python_bin}"
echo "Using Node: ${node_bin}"

rm -rf release/TTF release/TTC release/SuperTTC release/ZIP

"${python_bin}" tools/check_sources.py
"${python_bin}" tools/instantiate.py --clean --jobs "${maximum_parallels}" --weights "${weights}"
"${node_bin}" tools/build_otb.mjs --weights "${weights}" --jobs "${maximum_parallels}"
"${node_bin}" tools/build_ttc_otb.mjs --weights "${weights}" --jobs "${maximum_parallels}" --input-dir release/TTF --output-dir release/TTC
"${node_bin}" tools/build_super_ttc_otb.mjs --weights "${weights}" --input-dir release/TTC --output-dir release/SuperTTC
"${python_bin}" tools/package_release.py --ttf-dir release/TTF --ttc-dir release/TTC --super-ttc-dir release/SuperTTC --zip-dir release/ZIP

cat <<'EOF'

TTF/TTC/Super TTC build and packaging complete.
EOF
