$target = Join-Path $PSScriptRoot "release\win-unpacked\Aloy.exe"
$workDir = Join-Path $PSScriptRoot "release\win-unpacked"

$wshShell = New-Object -ComObject WScript.Shell

# 1. Start Menu Shortcut
$startMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$startMenuPath = Join-Path $startMenuDir "Aloy.lnk"
$shortcut = $wshShell.CreateShortcut($startMenuPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $workDir
$shortcut.Description = "Aloy AI Companion Application"
$shortcut.Save()
Write-Host "Created Start Menu Shortcut at: $startMenuPath"

# 2. User Pinned Taskbar Shortcut Folder
$taskbarDir = "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
if (-not (Test-Path $taskbarDir)) {
    New-Item -ItemType Directory -Path $taskbarDir -Force | Out-Null
}
$taskbarPath = Join-Path $taskbarDir "Aloy.lnk"
$shortcutTB = $wshShell.CreateShortcut($taskbarPath)
$shortcutTB.TargetPath = $target
$shortcutTB.WorkingDirectory = $workDir
$shortcutTB.Description = "Aloy AI Companion Application"
$shortcutTB.Save()
Write-Host "Created Taskbar Shortcut at: $taskbarPath"

# 3. Invoke Shell.Application Verb Pin if available
try {
    $shellApp = New-Object -ComObject Shell.Application
    $folder = $shellApp.NameSpace($workDir)
    $item = $folder.ParseName("Aloy.exe")
    $verbs = $item.Verbs()
    $pinned = $false
    foreach ($verb in $verbs) {
        if ($verb.Name -replace "&", "" -match "Pin to taskbar") {
            $verb.DoIt()
            $pinned = $true
            Write-Host "Triggered 'Pin to taskbar' shell verb successfully."
            break
        }
    }
    if (-not $pinned) {
        Write-Host "Shell verb pinning restricted by OS; shortcut added to TaskBar User Pinned folder."
    }
} catch {
    Write-Host "Notice: Shell verb invocation exception: $_"
}
