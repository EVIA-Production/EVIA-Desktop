@echo off
cd /d d:\repositories\EVIA\EVIA-Desktop
echo === Cleaning dist/renderer ===
if exist dist\renderer rmdir /s /q dist\renderer
echo === Running vite build ===
call npm run build:renderer
echo === Build complete ===
echo === Checking for new URL in build ===
findstr /s /c:"taylos.ai" dist\renderer\*.js
if %errorlevel%==0 (
    echo === SUCCESS: New URL found ===
) else (
    echo === FAILED: New URL not found ===
    findstr /s /c:"tryevia.ai" dist\renderer\*.js
)
pause
