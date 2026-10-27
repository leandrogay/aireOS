<#
.SYNOPSIS
Create (or rotate) the Secret Manager secrets one environment needs.

.DESCRIPTION
For each secret in deploy/<env>/api.secrets.yaml:
  - creates the secret if it does not exist
  - adds a value: AUTH_SESSION_SECRET is generated, anything else is asked for
    with a hidden prompt. Values are stored with no trailing newline (piping
    text in PowerShell adds one, which breaks an OAuth client secret).
  - lets the API's service account read it

A secret that already has a value is left alone unless named with -Name, so the
script is safe to re-run. Rotating = run with -Name, then redeploy, because a
running revision keeps the value it started with.
setup-secrets.sh is the bash version; keep the two in step.

.EXAMPLE
./deploy/setup-secrets.ps1 -Env test

.EXAMPLE
# Rotate one secret (AUTH_SESSION_SECRET signs everyone out).
./deploy/setup-secrets.ps1 -Env test -Name GOOGLE_OAUTH_CLIENT_SECRET
#>
param(
    [Parameter(Mandatory = $true)]
    [Alias('Env')]
    [string]$Environment,
    [string]$Name
)

# ==== Helpers ====

# Same reader as deploy.ps1: KEY=VALUE (or KEY: VALUE), skipping # comments.
function Read-Settings([string]$Path, [string]$Separator) {
    if (-not (Test-Path $Path)) { throw "Missing $Path" }
    $settings = [ordered]@{}
    foreach ($raw in Get-Content $Path) {
        $line = $raw.Trim()
        if (-not $line -or $line.StartsWith('#')) { continue }
        $index = $line.IndexOf($Separator)
        if ($index -lt 1) { throw "Cannot read '$line' in $Path" }
        $key = $line.Substring(0, $index).Trim()
        $settings[$key] = $line.Substring($index + $Separator.Length).Trim().Trim('"')
    }
    return $settings
}

function Invoke-Gcloud {
    & gcloud @args
    if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0]) $($args[1]) failed (exit $LASTEXITCODE)" }
}

function New-SessionSecret {
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Read-HiddenValue([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

# ==== Settings ====

$EnvDir = Join-Path $PSScriptRoot $Environment
if (-not (Test-Path $EnvDir)) { throw "No deploy settings for '$Environment' (expected $EnvDir)" }
$Target = Read-Settings (Join-Path $EnvDir 'target.env') '='
$Secrets = Read-Settings (Join-Path $EnvDir 'api.secrets.yaml') ': '
if ($Name -and -not $Secrets.Contains($Name)) {
    throw "$Name is not in $EnvDir\api.secrets.yaml"
}

# ==== Secrets ====

foreach ($entry in $Secrets.GetEnumerator()) {
    $envVar = $entry.Key
    $secretId = $entry.Value.Split(':')[0]
    if ($Name -and $envVar -ne $Name) { continue }

    & gcloud secrets describe $secretId --project $Target.PROJECT --format 'value(name)' 2>$null | Out-Null
    $exists = ($LASTEXITCODE -eq 0)
    $hasValue = $false
    if ($exists) {
        $versions = & gcloud secrets versions list $secretId --project $Target.PROJECT `
            --filter 'state=enabled' --limit 1 --format 'value(name)'
        $hasValue = [bool]$versions
    }

    if ($hasValue -and -not $Name) {
        Write-Host "$envVar ($secretId) already has a value; skipping. Rotate with -Name $envVar."
        continue
    }

    if (-not $exists) {
        Invoke-Gcloud secrets create $secretId --project $Target.PROJECT --replication-policy automatic
    }

    if ($envVar -eq 'AUTH_SESSION_SECRET') {
        $value = New-SessionSecret
        Write-Host "Generated a new $envVar."
    }
    else {
        $value = Read-HiddenValue "Value for $envVar"
        if (-not $value) { throw "No value entered for $envVar" }
    }

    # WriteAllText writes exactly the string: no BOM, no trailing newline.
    $tempFile = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($tempFile, $value)
        Invoke-Gcloud secrets versions add $secretId --project $Target.PROJECT --data-file $tempFile
    }
    finally {
        Remove-Item $tempFile -Force
    }

    Invoke-Gcloud secrets add-iam-policy-binding $secretId --project $Target.PROJECT `
        --member "serviceAccount:$($Target.API_SERVICE_ACCOUNT)" `
        --role roles/secretmanager.secretAccessor | Out-Null
    Write-Host "$envVar ($secretId) set; $($Target.API_SERVICE_ACCOUNT) can read it." -ForegroundColor Green
}

Write-Host 'Done. Redeploy (deploy.ps1) for running services to pick up new values.'
