@echo off
REM ─── ICMS Startup Script (Windows native) ──────────────────────────────────
REM Double-click this file OR run: D:\CLAUDE\start-icms.bat
REM Opens three windows: PostgreSQL check, Backend API, Frontend Dev Server

title ICMS Launcher
color 0A
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║      ICMS — Windows Startup Script       ║
echo  ╚══════════════════════════════════════════╝
echo.

REM ── Step 1: Check Docker ──────────────────────────────────────────────────
echo [1/4] Checking Docker...
docker info > nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Docker is not running.
    echo   Please open Docker Desktop and wait for it to fully start.
    pause
    exit /b 1
)
echo   OK - Docker is running

REM ── Step 2: Start PostgreSQL container ───────────────────────────────────
echo [2/4] Starting PostgreSQL...
docker ps --filter name=icms-pg --filter status=running --format "{{.Names}}" | findstr "icms-pg" > nul 2>&1
if %errorlevel% equ 0 (
    echo   OK - icms-pg already running
) else (
    docker ps -a --filter name=icms-pg --format "{{.Names}}" | findstr "icms-pg" > nul 2>&1
    if %errorlevel% equ 0 (
        docker start icms-pg > nul
        echo   OK - icms-pg started
    ) else (
        echo   Creating icms-pg container...
        docker run -d --name icms-pg -e POSTGRES_PASSWORD=icms123 -e POSTGRES_DB=icms -p 5432:5432 postgres:16-alpine > nul
        echo   OK - icms-pg created and started
        echo   Waiting 5s for PostgreSQL to initialize...
        timeout /t 5 /nobreak > nul
        docker exec icms-pg psql -U postgres -d icms -f C:/notexist 2>nul
    )
    timeout /t 2 /nobreak > nul
)

REM ── Step 3: Run migrations ────────────────────────────────────────────────
echo [3/4] Running migrations...
cd /d D:\CLAUDE\icms-backend
node migrate.js
if %errorlevel% neq 0 (
    echo   ERROR: Migration failed!
    pause
    exit /b 1
)

REM ── Step 4: Start Backend + Frontend in new windows ──────────────────────
echo [4/4] Starting services...

REM Start backend in a new window
start "ICMS Backend (port 3001)" cmd /k "cd /d D:\CLAUDE\icms-backend && echo Starting ICMS Backend... && node src/index.js"

REM Wait 2 seconds then start frontend
timeout /t 2 /nobreak > nul
start "ICMS Frontend (port 5173)" cmd /k "cd /d D:\CLAUDE\icms-frontend && echo Starting ICMS Frontend... && node node_modules/vite/bin/vite.js --host"

timeout /t 3 /nobreak > nul

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   ICMS is starting!                                  ║
echo  ╠══════════════════════════════════════════════════════╣
echo  ║  App:     http://localhost:5173                      ║
echo  ║  Network: http://100.82.160.77:5173                  ║
echo  ║  API:     http://localhost:3001/api/health           ║
echo  ║  Login:   owner@icms.com  /  owner123                ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  Two windows have opened: Backend and Frontend
echo  Close those windows to stop the services.
echo.
pause
