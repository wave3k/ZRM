# =========================================================================
# ZRM — Tunnel SSH vers le serveur LLM distant
# =========================================================================
# Ouvre un tunnel local 11434 -> VPS:11434 (Ollama).
# Laisse cette fenetre ouverte pendant que tu utilises ZRM en mode Discussion.
#
# Usage :  .\scripts\tunnel.ps1
# =========================================================================

param(
  [string]$VpsHost = $env:ZRM_VPS_HOST,
  [int]$Port = 11434,
  [string]$User = "root"
)

if (-not $VpsHost) {
  $configFile = Join-Path $PSScriptRoot "..\zrm.config.json"
  if (Test-Path $configFile) {
    try {
      $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
      if ($cfg.vpsHost) { $VpsHost = $cfg.vpsHost }
    } catch {}
  }
}

if (-not $VpsHost) {
  Write-Host "Adresse du VPS manquante." -ForegroundColor Red
  Write-Host "  .\scripts\tunnel.ps1 -VpsHost 1.2.3.4" -ForegroundColor Yellow
  Write-Host "  ou definis `$env:ZRM_VPS_HOST" -ForegroundColor Yellow
  exit 1
}

$key = Join-Path $env:USERPROFILE ".ssh\zrm_vps"
$keyArg = if (Test-Path $key) { @("-i", $key) } else { @() }

Write-Host ""
Write-Host "  ZRM — tunnel vers $VpsHost" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:$Port  ->  ${VpsHost}:$Port" -ForegroundColor DarkGray
Write-Host "  Ctrl+C pour fermer" -ForegroundColor DarkGray
Write-Host ""

ssh @keyArg -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 `
  -L "${Port}:127.0.0.1:${Port}" "${User}@${VpsHost}"
