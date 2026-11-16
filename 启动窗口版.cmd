@echo off
rem Start without a console window; errors go to data\logs\app.log
cd /d "%~dp0"
start "" pythonw launcher.py --window %*
