@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 20 or newer, then retry.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:8787 after the server starts.
node server\index.cjs
pause
