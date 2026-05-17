@echo off
setlocal

cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" (
  set "PY=.venv\Scripts\python.exe"
  goto run
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; raise SystemExit(sys.version_info < (3, 9))" >nul 2>nul
  if not errorlevel 1 (
    py -3 "%~dp0run.py" %*
    exit /b %errorlevel%
  )
)

where python >nul 2>nul
if not errorlevel 1 (
  python -c "import sys; raise SystemExit(sys.version_info < (3, 9))" >nul 2>nul
  if not errorlevel 1 (
    set "PY=python"
    goto run
  )
)

echo Python 3.9+ was not found.
echo Install Python 3.9 or newer, then run this script again.
exit /b 1

:run
"%PY%" "%~dp0run.py" %*
