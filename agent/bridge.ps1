# -*- coding: utf-8 -*-
param(
    [string]$Text,
    [string]$Aumid = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@

function Get-Aumid {
    if ($Aumid) { return $Aumid }
    $app = Get-StartApps | Where-Object { $_.Name -like '*Samsung Notes*' -or $_.Name -like '*Samsung*Notes*' } | Select-Object -First 1
    if (-not $app) { throw 'Samsung Notes not found in StartApps' }
    return $app.AppID
}

function Get-NotesWindow {
    $p = Get-Process -Name 'SamsungNotes' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($p) { return $p.MainWindowHandle }
    return [IntPtr]::Zero
}

# 1. запущено ли приложение
$h = Get-NotesWindow
if ($h -eq [IntPtr]::Zero) {
    $a = Get-Aumid
    Start-Process "shell:appsFolder\$a"
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        $h = Get-NotesWindow
        if ($h -ne [IntPtr]::Zero) { break }
    }
    if ($h -eq [IntPtr]::Zero) { throw 'Samsung Notes window did not appear' }
    Start-Sleep -Milliseconds 1500
}

# 2. сфокусировать
if ([W]::IsIconic($h)) { [W]::ShowWindow($h, 9) | Out-Null }
[W]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 700

# 3. сохранить буфер обмена
$savedClip = $null
try { $savedClip = Get-Clipboard -Format Text -Raw } catch {}

# 4. новая заметка
[System.Windows.Forms.SendKeys]::SendWait('^n')
Start-Sleep -Milliseconds 900

# 5. вставить текст
try { Set-Clipboard -Value $Text -ErrorAction Stop } catch { throw 'clipboard set failed' }
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 600

# 6. сохранить (автосейв по таймеру), но и вручную Hibernate: Ctrl+S
[System.Windows.Forms.SendKeys]::SendWait('^s')
Start-Sleep -Milliseconds 400

# 7. восстановить буфер
try {
    if ($null -ne $savedClip) { Set-Clipboard -Value $savedClip -ErrorAction SilentlyContinue }
    else { Set-Clipboard -Value '' -ErrorAction SilentlyContinue }
} catch {}

Write-Output 'OK'
