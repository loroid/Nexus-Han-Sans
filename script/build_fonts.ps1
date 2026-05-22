param(
    [int]$Jobs = 12,
    [string[]]$Weights = @("1-27")
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
Set-Location -LiteralPath $Root

$Python = if ($env:PYTHON) { $env:PYTHON } else { "python" }
$Node = if ($env:NODE) { $env:NODE } else { "node" }
$WeightSpec = (($Weights -join ",") -replace "[\s;]+", ",").Trim(",")

Write-Host "Using Python: $Python"
Write-Host "Using Node: $Node"
Write-Host "Weights: $WeightSpec"
Write-Host "Jobs: $Jobs"

function Remove-OutputDirectory {
    param([string]$RelativePath)
    $Target = [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
    $RootPath = [System.IO.Path]::GetFullPath($Root)
    if (-not $Target.StartsWith($RootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove outside project root: $Target"
    }
    if (Test-Path -LiteralPath $Target) {
        Get-ChildItem -LiteralPath $Target -Force | Remove-Item -Recurse -Force
    } else {
        New-Item -ItemType Directory -Path $Target | Out-Null
    }
}

function Invoke-Native {
    param(
        [string]$File,
        [string[]]$Arguments
    )
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$File failed with exit code $LASTEXITCODE"
    }
}

Remove-OutputDirectory "release\TTF"
Remove-OutputDirectory "release\TTC"
Remove-OutputDirectory "release\SuperTTC"
Remove-OutputDirectory "release\ZIP"

Invoke-Native $Python @("-B", "tools\check_sources.py")
Invoke-Native $Python @("-B", "tools\instantiate.py", "--clean", "--jobs", "$Jobs", "--weights", "$WeightSpec")
Invoke-Native $Node @("tools\build_otb.mjs", "--weights", "$WeightSpec", "--jobs", "$Jobs")
Invoke-Native $Node @("tools\build_ttc_otb.mjs", "--weights", "$WeightSpec", "--jobs", "$Jobs", "--input-dir", "release\TTF", "--output-dir", "release\TTC")
Invoke-Native $Node @("tools\build_super_ttc_otb.mjs", "--weights", "$WeightSpec", "--input-dir", "release\TTC", "--output-dir", "release\SuperTTC")
Invoke-Native $Python @("-B", "tools\package_release.py", "--ttf-dir", "release\TTF", "--ttc-dir", "release\TTC", "--super-ttc-dir", "release\SuperTTC", "--zip-dir", "release\ZIP")

Write-Host ""
Write-Host "TTF/TTC/Super TTC build and packaging complete."
