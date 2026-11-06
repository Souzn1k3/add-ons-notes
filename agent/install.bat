@echo off
title Notes Bridge - install
setlocal

set AGENTDIR=%~dp0
set STARTDIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

rem find pythonw.exe (no console window)
set PYW=
for /f "delims=" %%i in ('where pythonw.exe 2^>nul') do (
    if not defined PYW set PYW=%%i
)
if not defined PYW (
    py -c "import sys,os;open(os.environ[u'TEMP']+u'\\nb_pyw.txt','w').write(os.path.join(os.path.dirname(sys.executable),u'pythonw.exe'))" 2>nul
    for /f "delims=" %%i in (%TEMP%\nb_pyw.txt) do set PYW=%%i
    del %TEMP%\nb_pyw.txt 2>nul
)
if not defined PYW (
    echo [ERROR] pythonw.exe not found. Install Python 3.10+ for Windows first.
    pause
    exit /b 1
)

powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%STARTDIR%\Notes Bridge Agent.lnk'); $s.TargetPath='%PYW%'; $s.Arguments='main.py'; $s.WorkingDirectory='%AGENTDIR%'; $s.Description='Notes Bridge agent'; $s.Save()"

echo [OK] autostart shortcut created: Notes Bridge Agent.lnk

rem start agent right now in background
start "" "%PYW%" "%AGENTDIR%main.py"

echo.
echo === INSTALL DONE ===
if exist "%LOCALAPPDATA%\SBNAgent\port.txt" (
    echo Agent port:
    type "%LOCALAPPDATA%\SBNAgent\port.txt"
    echo.
    echo Token file: %LOCALAPPDATA%\SBNAgent\token.txt
) else (
    echo Agent is starting - wait 10-15 sec, then open the extension popup.
)
echo Open the extension popup ^> Settings ^> Test connection (should be green).
echo Ready. See README.md for details (Russian).
pause
