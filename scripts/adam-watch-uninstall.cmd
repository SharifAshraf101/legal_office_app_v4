@echo off
rem Removes the Adam watcher from THIS computer: stops it and deletes the
rem Startup shortcut. Double-click this file.
echo.
echo === Adam watcher - remove from %COMPUTERNAME% ===
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*adam-watch.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; $l=[Environment]::GetFolderPath('Startup')+'\Adam watcher.lnk'; if (Test-Path $l) { Remove-Item $l -Force }"
echo Done. The watcher is stopped and will not start at logon.
echo.
pause
