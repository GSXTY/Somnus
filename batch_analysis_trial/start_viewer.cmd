@echo off
setlocal
cd /d "%~dp0"
set "PYTHONDONTWRITEBYTECODE=1"
set "PYTHONIOENCODING=utf-8"
set "VIEWER_PYTHON=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not exist "%VIEWER_PYTHON%" set "VIEWER_PYTHON=python"
echo Starting read-only batch result viewer...
echo Open http://127.0.0.1:8766 after READ_ONLY_VIEWER appears below.
echo Keep this window open while using the viewer. Press Ctrl+C to stop.
echo.
"%VIEWER_PYTHON%" "%~dp0viewer.py" --input "D:\VVFLY\analyze_test_data_csv" --results "%~dp0docker_runs" --port 8766
set "VIEWER_EXIT=%ERRORLEVEL%"
echo.
echo Viewer stopped. Exit code %VIEWER_EXIT%.
echo If startup failed, the error details are printed above.
pause
exit /b %VIEWER_EXIT%
