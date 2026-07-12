# Deploy UniFact to staging.unifact.ai (Windows PowerShell).
# PEM path fact: company.infrastructure/staging-ssh-key-path
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-staging.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Key = if ($env:UNIFACT_SSH_KEY) { $env:UNIFACT_SSH_KEY } else { "C:\Users\admin\git\LightsailDefaultKey-us-east-1.pem" }
$HostName = if ($env:UNIFACT_SSH_HOST) { $env:UNIFACT_SSH_HOST } else { "staging.unifact.ai" }
$User = if ($env:UNIFACT_SSH_USER) { $env:UNIFACT_SSH_USER } else { "admin" }
$AppDir = if ($env:UNIFACT_APP_DIR) { $env:UNIFACT_APP_DIR } else { "/var/www/unifact" }

if (-not (Test-Path $Key)) {
    throw "SSH key not found: $Key (see company.infrastructure/staging-ssh-key-path)"
}

Write-Host "==> Building locally in $Root"
Set-Location $Root
npm install
npm run build

$ssh = @("-i", $Key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes")
$remote = "${User}@${HostName}"

Write-Host "==> Uploading dist + package files (preserves remote .env)"
# scp selected paths; host has no git.
$paths = @(
    "dist",
    "package.json",
    "package-lock.json",
    "ecosystem.config.cjs",
    "tsconfig.json",
    "Dockerfile",
    "README.md",
    "scripts",
    "docs",
    "src"
)
foreach ($p in $paths) {
    $local = Join-Path $Root $p
    if (-not (Test-Path $local)) { continue }
    Write-Host "  scp $p"
    & scp @ssh -r $local "${remote}:${AppDir}/"
}

Write-Host "==> npm install + pm2 restart"
& ssh @ssh $remote "cd $AppDir && npm install --omit=dev && sudo pm2 restart unifact && sudo pm2 save && curl -fsS http://127.0.0.1:4110/healthz && echo"

Write-Host "==> Deploy finished. Verify: curl -s http://$HostName/healthz"
