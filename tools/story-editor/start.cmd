@echo off
rem Story editor: double-click to start. Installs what is missing the first time.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 start.py %* & goto :done)
where python >nul 2>nul && (python start.py %* & goto :done)
echo Python 3.10 or newer is not installed. Get it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
:done
if errorlevel 1 pause
