@echo off
rem Installs the Adam watcher on THIS computer (run it only on the one computer
rem that is on 24/7). Double-click this file.
rem It: 1) checks the computer is ready, 2) adds a Startup shortcut so the
rem watcher starts after every logon, 3) starts the watcher now.
setlocal
cd /d "%~dp0.."
echo.
echo === Adam watcher - install on %COMPUTERNAME% ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js is not installed. Install it from https://nodejs.org and run this file again.
  goto :end
)
node scripts\adam-watch.mjs --check
if errorlevel 1 (
  echo.
  echo The computer is NOT ready - fix the lines marked [FAIL] above and run this file again.
  goto :end
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Adam watcher.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0adam-watch-start.vbs\"'; $s.WorkingDirectory='%~dp0..'; $s.Description='Adam watcher'; $s.Save()"
if errorlevel 1 (
  echo [FAIL] Could not create the Startup shortcut.
  goto :end
)
echo [OK]   Startup shortcut created - the watcher will start after every logon.
rem Stop a watcher that is already running, then start a fresh one.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*adam-watch.mjs*' -and $_.CommandLine -notlike '*--check*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
wscript.exe "%~dp0adam-watch-start.vbs"
echo [OK]   Watcher started.
echo.
echo Done. Adam now picks up new requests by himself.
echo Keep Chrome open and signed in to ChatGPT and Gemini on this computer.
echo Log file: %USERPROFILE%\adam-jobs\watch.log
:end
echo.
pause
