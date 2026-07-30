# Installs the real MSIX on this machine so you can test what Microsoft tests.
#
# Everything we have verified so far ran dist\win-unpacked\Demist.exe, which is
# the same code WITHOUT the MSIX container. Store certification failed on a
# first-run model load that never failed here, and that gap is exactly why.
#
# RUN THIS IN AN ADMINISTRATOR POWERSHELL. Trusting a certificate machine-wide
# needs elevation; nothing else here does.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-test-appx.ps1
#
# It signs a COPY. The .appx you upload to Partner Center must stay unsigned -
# the Store signs it with your real publisher certificate.

$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist    = Join-Path (Split-Path -Parent $here) 'dist'
$source  = Get-ChildItem $dist -Filter '*.appx' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $source) { throw "No .appx in $dist - run 'npm run dist' first." }

# Must match Identity/Publisher in the package exactly or Windows refuses it.
$publisher = 'CN=99817A35-A5E3-4E7A-8F44-601153999894'
$testCopy  = Join-Path $dist 'Demist-signed-for-testing.appx'
$pfx       = Join-Path $env:TEMP 'demist-test-cert.pfx'
$pfxPass   = ConvertTo-SecureString -String 'demist-local-test' -Force -AsPlainText

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Not elevated. Right-click PowerShell -> Run as administrator, then run this again."
}

Write-Host "source package : $($source.Name) ($([int]($source.Length/1MB)) MB)"
Write-Host "publisher      : $publisher`n"

# 1. A code-signing certificate whose subject matches the package publisher.
Write-Host "1/5  creating self-signed certificate..."
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $publisher } | Select-Object -First 1
if (-not $cert) {
  $cert = New-SelfSignedCertificate -Type Custom -Subject $publisher `
    -KeyUsage DigitalSignature -FriendlyName 'Demist local test signing' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
  Write-Host "     created $($cert.Thumbprint)"
} else {
  Write-Host "     reusing $($cert.Thumbprint)"
}

# 2. Windows only installs packages signed by a certificate it trusts.
Write-Host "2/5  trusting it (this is the part that needs admin)..."
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pfxPass | Out-Null
Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pfxPass | Out-Null

# 3. Sign a copy, never the upload artefact.
Write-Host "3/5  signing a copy..."
Copy-Item $source.FullName $testCopy -Force
$signtool = Get-ChildItem "$env:LOCALAPPDATA\electron-builder" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($signtool) {
  & $signtool.FullName sign /fd SHA256 /f $pfx /p 'demist-local-test' $testCopy | Out-Null
} else {
  Set-AuthenticodeSignature -FilePath $testCopy -Certificate $cert -HashAlgorithm SHA256 | Out-Null
}
Write-Host "     signed $([System.IO.Path]::GetFileName($testCopy))"

# 4. Replace any previous test install so this is a genuine first run.
Write-Host "4/5  removing any previous install..."
Get-AppxPackage -Name 'Demist.Demist' -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
# A true first run also means no downloaded models and no saved session.
$demist = Join-Path $env:USERPROFILE '.demist'
if (Test-Path $demist) {
  Write-Host "     NOTE: $demist exists. Rename it to force a genuine cold start:" -ForegroundColor Yellow
  Write-Host "       Rename-Item '$demist' '$demist.bak'" -ForegroundColor Yellow
}

# 5. Install.
Write-Host "5/5  installing..."
Add-AppxPackage -Path $testCopy
$pkg = Get-AppxPackage -Name 'Demist.Demist'
Write-Host "`ninstalled: $($pkg.PackageFullName)" -ForegroundColor Green
Write-Host "`nLaunch it from the Start menu (search 'Demist'), or:"
Write-Host "  explorer.exe shell:appsFolder\$($pkg.PackageFamilyName)!App"
Write-Host "`nWhat to check:"
Write-Host "  - the record button unlocks WITHOUT any transcription-model download"
Write-Host "  - a recording produces transcript text"
Write-Host "  - term cards appear (the LLM does still download - that part is expected)"
Write-Host "`nAn installed MSIX has no visible console, so if anything fails, the"
Write-Host "on-screen message is the diagnosis - it now names the underlying cause."
Write-Host "`nTo remove it again:"
Write-Host "  Get-AppxPackage -Name Demist.Demist | Remove-AppxPackage"
