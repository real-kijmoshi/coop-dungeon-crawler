# Coop Dungeon Crawler - installer for Windows PowerShell.
#   irm __BASE__/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$base = '__BASE__'
$server = '__SERVER__'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$dir = Join-Path $env:LOCALAPPDATA 'Programs\coop-dungeon-crawler'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Write-Host "Downloading Coop Dungeon Crawler (windows/$arch)..." -ForegroundColor Yellow
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest "$base/dl/cdc-windows-$arch.exe" -OutFile (Join-Path $dir 'cdc.exe') -UseBasicParsing

# Remember this server as the default for the login screen.
$cfg = Join-Path $env:APPDATA 'coop-dungeon-crawler'
New-Item -ItemType Directory -Force -Path $cfg | Out-Null
Set-Content -Path (Join-Path $cfg 'server') -Value $server

# Add to the user PATH if needed.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $dir })) {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$dir", 'User')
  Write-Host "Added $dir to your PATH (open a new terminal to use it)."
}
Write-Host "Installed! Run:  cdc" -ForegroundColor Green
