@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org first, then reopen this file.
  pause
  exit /b 1
)
echo Installing Cold Static dependencies. Internet is needed for this step only.
call npm.cmd ci --omit=dev
if errorlevel 1 (
  echo Installation failed. Check your internet connection and the error above.
  pause
  exit /b 1
)
echo Installation complete. Open start-game.cmd to host a game.
pause
