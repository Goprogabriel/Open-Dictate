$ErrorActionPreference = "Stop"

if (-not $env:WINDOWS_CERTIFICATE_BASE64) {
  throw "WINDOWS_CERTIFICATE_BASE64 is missing."
}
if (-not $env:WINDOWS_CERTIFICATE_PASSWORD) {
  throw "WINDOWS_CERTIFICATE_PASSWORD is missing."
}

$certificateDirectory = Join-Path $env:RUNNER_TEMP "open-dictate-certificate"
$certificatePath = Join-Path $certificateDirectory "code-signing.pfx"
New-Item -ItemType Directory -Force -Path $certificateDirectory | Out-Null
[IO.File]::WriteAllBytes($certificatePath, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64))

$securePassword = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
$certificate = Import-PfxCertificate `
  -FilePath $certificatePath `
  -CertStoreLocation Cert:\CurrentUser\My `
  -Password $securePassword

if (-not $certificate.Thumbprint) {
  throw "The Windows certificate was imported without a thumbprint."
}

"WINDOWS_CERTIFICATE_THUMBPRINT=$($certificate.Thumbprint)" | Out-File `
  -FilePath $env:GITHUB_ENV `
  -Encoding utf8 `
  -Append

Remove-Item -Force $certificatePath
Write-Host "Windows signing certificate imported into the current-user certificate store."
