' Starts the Adam watcher hidden (no console window). A shortcut to this file
' in the Windows Startup folder makes the Adam consultation run by itself
' after every logon. To stop it: end the "node.exe" process that runs
' adam-watch.mjs (Task Manager), or delete the Startup shortcut.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
sh.Run "cmd /c node scripts\adam-watch.mjs", 0, False
