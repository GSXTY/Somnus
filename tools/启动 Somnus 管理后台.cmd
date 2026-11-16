@echo off
title Somnus Maintainer Admin
pushd "%~dp0.." || exit /b 1
python -m maintainer_admin --standard "%~dp0..\..\Somnus-Default"
set "SOMNUS_EXIT_CODE=%errorlevel%"
popd
if not "%SOMNUS_EXIT_CODE%"=="0" pause
exit /b %SOMNUS_EXIT_CODE%
