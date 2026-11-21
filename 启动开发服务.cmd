@echo off
setlocal
cd /d "%~dp0"
python -B launcher.py %*
pause
endlocal
