@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org first.
  pause
  exit /b 1
)
if not exist "node_modules\express\package.json" (
  echo Open install.cmd once before starting a game.
  pause
  exit /b 1
)
node server.js
pause
