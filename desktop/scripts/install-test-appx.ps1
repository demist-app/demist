# Installs the real MSIX on this machine so you can test what Microsoft tests.
#
# Everything verified so far ran dist\win-unpacked\Demist.exe - the same code
# WITHOUT the MSIX container. Store certification failed on a first-run model
# load that never failed here, and that gap is exactly why.
#
# This REGISTERS the package from loose files rather than signing and
# installing it. Signing was the original approach and it does not work here:
# the only signtool on this machine comes from electron-builder's
# winCodeSign-2.6.0 cache (both the ia32 and x64 builds), and both are too old
# to sign an APPX -
#
#     SignTool Error: A required function is not present.
#
# Installing the Windows SDK just to sign a throwaway test build is a lot of
# download for nothing. Add-AppxPackage -Register needs no signature at all and
# runs the app in the same container with the same identity and capabilities,
# which is the thing we actually want to exercise.
#
# RUN IN AN ADMINISTRATOR POWERSHELL (only to switch Developer Mode on):
#   powershell -ExecutionPolicy Bypass -File scripts\install-test-appx.ps1
#
# The .appx you upload to Partner Center is never touched.

$ErrorActionPreference = 'Stop'

$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist   = Join-Path (Split-Path -Parent $here) 'dist'
$source = Get-ChildItem $dist -Filter 'Demist*.appx' |
          Where-Object { $_.Name -notmatch 'signed-for-testing' } |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $source) { throw "No .appx in $dist - run 'npm run dist' first." }

$staged  = Join-Path $dist 'appx-registered'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host "package: $($source.Name) ($([int]($source.Length/1MB)) MB)`n"

# 1. Developer Mode. Registering loose files is refused without it.
Write-Host "1/4  checking Developer Mode..."
$key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
$dev = (Get-ItemProperty $key -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense
if ($dev -ne 1) {
  if (-not $isAdmin) {
    throw "Developer Mode is off and this shell is not elevated. Either re-run as administrator, or turn it on by hand: Settings > System > For developers > Developer Mode."
  }
  New-Item -Path $key -Force | Out-Null
  New-ItemProperty -Path $key -Name AllowDevelopmentWithoutDevLicense -Value 1 -PropertyType DWord -Force | Out-Null
  Write-Host "     enabled"
} else {
  Write-Host "     already on"
}

# 2. An .appx is a zip. Unpack it so the manifest can be registered directly.
Write-Host "2/4  unpacking the package..."
if (Test-Path $staged) { Remove-Item $staged -Recurse -Force }
New-Item -ItemType Directory $staged | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($source.FullName, $staged)
# These describe the packaged form and confuse a loose-file registration.
foreach ($junk in 'AppxBlockMap.xml', 'AppxSignature.p7x', '[Content_Types].xml') {
  $p = Join-Path $staged $junk
  if (Test-Path $p) { Remove-Item $p -Force }
}
$manifest = Join-Path $staged 'AppxManifest.xml'
if (-not (Test-Path $manifest)) { throw "No AppxManifest.xml inside $($source.Name)." }
Write-Host "     $([int]((Get-ChildItem $staged -Recurse -File | Measure-Object Length -Sum).Sum/1MB)) MB extracted"

# 3. Replace any previous registration so this is a genuine first run.
Write-Host "3/4  removing any previous install..."
Get-AppxPackage -Name 'Demist.Demist' -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue

# 4. Register.
Write-Host "4/4  registering..."
Add-AppxPackage -Register $manifest
$pkg = Get-AppxPackage -Name 'Demist.Demist'
Write-Host "`nregistered: $($pkg.PackageFullName)" -ForegroundColor Green

$demist = Join-Path $env:USERPROFILE '.demist'
if (Test-Path $demist) {
  Write-Host "`nFOR A GENUINE FIRST RUN, hide your cached models first:" -ForegroundColor Yellow
  Write-Host "  Rename-Item '$demist' '$demist.bak'" -ForegroundColor Yellow
  Write-Host "Otherwise the app finds them and proves nothing." -ForegroundColor Yellow
}

Write-Host "`nLaunch from the Start menu (search 'Demist'), or:"
Write-Host "  explorer.exe shell:appsFolder\$($pkg.PackageFamilyName)!App"
Write-Host "`nWhat to check:"
Write-Host "  - the record button unlocks with NO transcription-model download"
Write-Host "  - a recording produces transcript text"
Write-Host "  - term cards appear (the 2GB LLM does still download - expected)"
Write-Host "`nAn installed MSIX has no visible console, so if anything fails the"
Write-Host "on-screen message IS the diagnosis - it now names the underlying cause."
Write-Host "`nAfterwards:"
Write-Host "  Get-AppxPackage -Name Demist.Demist | Remove-AppxPackage"
Write-Host "  Rename-Item '$demist.bak' '$demist'   # if you renamed it"
