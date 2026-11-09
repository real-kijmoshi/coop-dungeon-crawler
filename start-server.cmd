@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
node "%~dp0start-server.js"
if errorlevel 1 (
  echo.
  echo The server stopped with an error. See the message above.
  pause
  exit /b 1
)
