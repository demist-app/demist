# Stages the Visual C++ 2015-2022 runtime that gets bundled beside every native
# module at package time (see bundle-vcredist.js for why that is necessary).
#
# The DLLs are Microsoft's, so they are gitignored rather than committed. Run
# this once on a machine that has the Visual C++ Redistributable installed -
# which any machine capable of building this project will.
#
#   powershell -ExecutionPolicy Bypass -File scripts\stage-vcredist.ps1
$ErrorActionPreference = 'Stop'
$dst = Join-Path (Split-Path -Parent $PSScriptRoot) 'vcredist'
New-Item -ItemType Directory $dst -Force | Out-Null
$want = 'msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','msvcp140_atomic_wait.dll',
        'msvcp140_codecvt_ids.dll','vcruntime140.dll','vcruntime140_1.dll','concrt140.dll'
$missing = @()
foreach ($f in $want) {
  $src = Join-Path "$env:WINDIR\System32" $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $dst $f) -Force } else { $missing += $f }
}
Write-Host "staged $((Get-ChildItem $dst -Filter *.dll).Count) runtime DLLs into $dst"
if ($missing) { Write-Host "NOT FOUND in System32: $($missing -join ', ')" -ForegroundColor Yellow
                Write-Host "Install the Visual C++ Redistributable (x64) and re-run." -ForegroundColor Yellow }
