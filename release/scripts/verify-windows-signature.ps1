param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = "Stop"
$signature = Get-AuthenticodeSignature -FilePath $Path

if ($signature.Status -ne "Valid") {
  throw "Invalid Authenticode signature for '$Path': $($signature.StatusMessage)"
}
if (-not $signature.TimeStamperCertificate) {
  throw "The Authenticode signature for '$Path' has no trusted timestamp."
}

Write-Host "Valid, timestamped Authenticode signature: $Path"
