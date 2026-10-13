@echo off
rem Mo bieu do codebase (dashboard Understand-Anything) khong can Claude Code, khong ton token.
rem Can: Node.js + plugin da cai (claude plugin install understand-anything). Dong cua so nay de tat.
setlocal enabledelayedexpansion
set "PROJECT=%~dp0.."
set "PLUGIN="
for /d %%V in ("%USERPROFILE%\.claude\plugins\cache\understand-anything\understand-anything\*") do set "PLUGIN=%%V"
if not defined PLUGIN (
  echo Chua cai plugin. Chay: claude plugin marketplace add Egonex-AI/Understand-Anything
  echo roi: claude plugin install understand-anything
  pause & exit /b 1
)
set "GRAPH_DIR=%PROJECT%"
set "UNDERSTAND_ACCESS_TOKEN=local"
set "URL=http://127.0.0.1:5199/?token=local"
echo Dang mo %URL%  (dong cua so nay de tat)
start "" /b cmd /c "timeout /t 6 >nul & start "" %URL%"
cd /d "%PLUGIN%\packages\dashboard"
call npx vite --host 127.0.0.1 --port 5199 --strictPort
pause
