@echo off
title Notes Bridge - uninstall
echo Removing autostart...
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Notes Bridge Agent.lnk" 2>nul
echo Stopping agent...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -like '*main.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Done. Autostart removed, agent stopped.
echo Note: agent data in %LOCALAPPDATA%\SBNAgent kept intact.
pause
