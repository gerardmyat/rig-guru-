@echo off
title Rig Guru
cd /d "%~dp0"
echo.
echo === Rig Guru launcher ===
echo Folder: %CD%
echo.
python -u run.py
echo.
echo --- Process ended (see messages above). ---
pause
