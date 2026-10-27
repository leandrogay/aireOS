<#
.SYNOPSIS
Build, push and deploy aireOS to one environment (deploy/<env>/).

.DESCRIPTION
Builds the api and web images on Cloud Build, pushes them to the environment's
Artifact Registry repository tagged with the git commit, then deploys both
Cloud Run services:
  - api: env vars from <env>/api.env.yaml (replacing all of them) and secrets
    from Secret Manager as listed in <env>/api.secrets.yaml
  - web: no runtime env vars; its settings are compiled in from <env>/web.build.env

Run deploy/setup-secrets.ps1 once per environment before the first deploy.
deploy.sh is the bash version; keep the two in step.

.EXAMPLE
./deploy/deploy.ps1 -Env test

.EXAMPLE
# Redeploy images that were already built for this commit.
./deploy/deploy.ps1 -Env test -SkipBuild -Tag 18a1947
#>
param(
    [Parameter(Mandatory = $true)]
    [Alias('Env')]
    [string]$Environment,
    [string]$Tag,
    [switch]$SkipBuild
)

# ==== Helpers ====

# Reads KEY=VALUE (or KEY: VALUE) lines, skipping blanks and # comments.
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

# ==== Settings ====

$Root = Split-Path $PSScriptRoot -Parent
$EnvDir = Join-Path $PSScriptRoot $Environment
if (-not (Test-Path $EnvDir)) { throw "No deploy settings for '$Environment' (expected $EnvDir)" }

$Target = Read-Settings (Join-Path $EnvDir 'target.env') '='
$BuildArgs = Read-Settings (Join-Path $EnvDir 'web.build.env') '='
$Secrets = Read-Settings (Join-Path $EnvDir 'api.secrets.yaml') ': '
$ApiEnvFile = Join-Path $EnvDir 'api.env.yaml'
if (-not (Test-Path $ApiEnvFile)) { throw "Missing $ApiEnvFile" }

if (Select-String -Path $ApiEnvFile -Pattern 'REPLACE_WITH' -Quiet) {
    throw "$ApiEnvFile still has a REPLACE_WITH placeholder. Fill it in first."
}

Push-Location $Root
try {
    if (-not $Tag) {
        # The tag is the commit, so it must describe exactly what gets built.
        if (git status --porcelain) {
            throw 'Commit your changes first: the image tag is the commit hash.'
        }
        $Tag = (git rev-parse --short HEAD).Trim()
    }

    $ApiImage = "$($Target.REGISTRY)/api:$Tag"
    $WebImage = "$($Target.REGISTRY)/web:$Tag"
    Write-Host "Deploying $Environment at $Tag" -ForegroundColor Cyan

    # ==== Build ====

    if (-not $SkipBuild) {
        Invoke-Gcloud builds submit backend --project $Target.PROJECT --tag $ApiImage

        $Substitutions = @(
            "_IMAGE=$WebImage",
            "_NEXT_PUBLIC_API_URL=$($BuildArgs.NEXT_PUBLIC_API_URL)",
            "_NEXT_PUBLIC_AUTH_ENABLED=$($BuildArgs.NEXT_PUBLIC_AUTH_ENABLED)",
            "_BACKEND_API_URL=$($BuildArgs.BACKEND_API_URL)"
        ) -join ','
        Invoke-Gcloud builds submit frontend/aireos --project $Target.PROJECT `
            --config deploy/cloudbuild.web.yaml --substitutions $Substitutions
    }

    # ==== Deploy ====

    # API first: the web service forwards /api/* to it.
    $SecretRefs = ($Secrets.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ','
    Invoke-Gcloud run deploy $Target.API_SERVICE --project $Target.PROJECT --region $Target.REGION `
        --image $ApiImage --service-account $Target.API_SERVICE_ACCOUNT `
        --env-vars-file $ApiEnvFile --set-secrets $SecretRefs

    # The web image carries its settings, so any runtime env var is a leftover.
    Invoke-Gcloud run deploy $Target.WEB_SERVICE --project $Target.PROJECT --region $Target.REGION `
        --image $WebImage --service-account $Target.WEB_SERVICE_ACCOUNT --clear-env-vars

    Write-Host "Deployed $Environment at $Tag. Open $($BuildArgs.NEXT_PUBLIC_API_URL)" -ForegroundColor Green
}
finally {
    Pop-Location
}
