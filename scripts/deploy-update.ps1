$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $PSScriptRoot
$Branch = if ($args.Count -gt 0) { $args[0] } else { "main" }

Set-Location $AppDir

Write-Host "[1/6] Fetching latest code from origin/$Branch..."
git fetch origin $Branch

Write-Host "[2/6] Switching to branch $Branch..."
git checkout $Branch

Write-Host "[3/6] Resetting working tree to origin/$Branch..."
git reset --hard ("origin/" + $Branch)

Write-Host "[4/6] Ensuring runtime directories..."
New-Item -ItemType Directory -Force -Path "$AppDir\outputs\generated" | Out-Null
New-Item -ItemType Directory -Force -Path "$AppDir\work\uploads" | Out-Null

Write-Host "[5/6] Refreshing runtime..."
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  try {
    pm2 describe makepicture *> $null
    pm2 restart makepicture --update-env
  } catch {
    pm2 start ecosystem.config.cjs --only makepicture --update-env
  }

  try {
    pm2 save *> $null
  } catch {
  }
} else {
  Write-Host "PM2 not found. Starting fallback process..."
  Start-Process -FilePath node -ArgumentList "src/server.mjs" -WorkingDirectory $AppDir -WindowStyle Hidden
}

Write-Host "[6/6] Done."
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  pm2 status makepicture
}
