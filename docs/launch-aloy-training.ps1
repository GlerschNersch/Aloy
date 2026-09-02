# Aloy Training Launcher
# Launches BizHawk + MCP bridge + starts the autoplay loop

param(
    [string]$RomPath = "C:\RetroBat\roms\snes\Super Mario All-Stars.zip",
    [string]$BizHawkPath = "$env:USERPROFILE\BizHawk\EmuHawk.exe",
    [int]$BridgePort = 8766
)

Write-Host "=== Aloy SMB2 Training Launcher ===" -ForegroundColor Cyan

# 1. Start BizHawk with socket enabled
Write-Host "`n[1/4] Starting BizHawk..." -ForegroundColor Yellow
$bizhawkArgs = "--socket_ip=127.0.0.1 --socket_port=$BridgePort `"$RomPath`""
Start-Process -FilePath $BizHawkPath -ArgumentList $bizhawkArgs -WindowStyle Normal

Start-Sleep -Seconds 4

# 2. Instructions for Lua bridge (user must do this once per session)
Write-Host "`n[2/4] MANUAL STEP REQUIRED:" -ForegroundColor Red
Write-Host "   1. In BizHawk go to Tools → Lua Console"
Write-Host "   2. Click Open Script and select:"
Write-Host "      $env:APPDATA\npm\node_modules\mcp-bizhawk\lua\bridge.lua"
Write-Host "   3. Confirm you see: [mcp-bizhawk] frame loop active"

Read-Host "`nPress Enter once the Lua bridge is running..."

# 3. Start the MCP server (if not already running via Claude Desktop / Gemini)
Write-Host "`n[3/4] MCP server should already be configured in your LLM client." -ForegroundColor Yellow
Write-Host "   (snes-emulator-bridge pointing at mcp-bizhawk)"

# 4. Start the autoplay loop (assumes Aloy server has bizhawk_autoplay_start tool)
Write-Host "`n[4/4] Ready to begin training." -ForegroundColor Green
Write-Host "   Use your LLM client to call: bizhawk_autoplay_start"
Write-Host "   Monitor progress in: $env:USERPROFILE\AloyFiles\aloy_smb2_master_progress.json"

Write-Host "`nDashboard tip: Run the dashboard script in another terminal:"
Write-Host "   node docs/aloy-dashboard.js" -ForegroundColor Cyan