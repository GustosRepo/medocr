@echo off
setlocal enabledelayedexpansion
:: ─────────────────────────────────────────────────────────────────────
::  MedOCR — One-command launcher for sleep referral intake (Windows)
:: ─────────────────────────────────────────────────────────────────────
cd /d "%~dp0"

if "%~1"=="" goto :start
if /i "%~1"=="start" goto :start
if /i "%~1"=="stop" goto :stop
if /i "%~1"=="logs" goto :logs
if /i "%~1"=="status" goto :status
if /i "%~1"=="update" goto :update
goto :usage

:: ── START ─────────────────────────────────────────────────────────────
:start
echo.
echo  ╔═══════════════════════════════════════════════╗
echo  ║        MedOCR  —  Referral Intake System      ║
echo  ╚═══════════════════════════════════════════════╝
echo.

:: Check Docker
where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed.
    echo   Install Docker Desktop from: https://www.docker.com/products/docker-desktop/
    exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo [WAIT] Docker Desktop is not running. Starting it...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
    echo   Waiting for Docker to start (this may take 30-60 seconds^)...
    set tries=0
    :docker_wait
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if not errorlevel 1 goto :docker_ready
    set /a tries+=1
    if !tries! gtr 40 (
        echo [ERROR] Docker did not start in time. Please open Docker Desktop manually and try again.
        exit /b 1
    )
    goto :docker_wait
)
:docker_ready
echo [OK] Docker is ready

:: Check Ollama
where ollama >nul 2>&1
if errorlevel 1 (
    echo [INFO] Ollama not installed — running in OCR-only mode (still accurate, just no LLM cross-check^)
    goto :launch
)

curl -sf http://127.0.0.1:11434/api/version >nul 2>&1
if not errorlevel 1 (
    echo [OK] Ollama is running
    goto :launch
)

echo [WAIT] Ollama is installed but not running. Starting it...
start "" /min ollama serve
timeout /t 3 /nobreak >nul
curl -sf http://127.0.0.1:11434/api/version >nul 2>&1
if not errorlevel 1 (
    echo [OK] Ollama started
) else (
    echo [WARN] Could not start Ollama — OCR-only mode will be used
)

:launch
echo.
echo [2/3] Pulling latest images and starting MedOCR services...
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
echo.
echo [3/3] Waiting for services to be healthy...
set tries=0
:health_wait
timeout /t 2 /nobreak >nul
curl -sf http://localhost:4387/api/config >nul 2>&1
if not errorlevel 1 goto :healthy
set /a tries+=1
if !tries! gtr 60 (
    echo [ERROR] Backend did not become healthy. Check logs with: docker compose logs api
    exit /b 1
)
goto :health_wait

:healthy
echo.
echo  ═══════════════════════════════════════════════════
echo    MedOCR is ready!
echo.
echo    Open your browser to:  http://localhost
echo.
echo    Upload PDFs and results appear automatically.
echo  ═══════════════════════════════════════════════════
echo.
start http://localhost
goto :eof

:: ── STOP ──────────────────────────────────────────────────────────────
:stop
echo Stopping MedOCR...
docker compose -f docker-compose.prod.yml down
echo [OK] MedOCR stopped
goto :eof

:: ── LOGS ──────────────────────────────────────────────────────────────
:logs
docker compose -f docker-compose.prod.yml logs -f --tail=100
goto :eof

:: ── STATUS ────────────────────────────────────────────────────────────
:status
echo MedOCR Service Status:
docker compose -f docker-compose.prod.yml ps
echo.
curl -sf http://localhost:8000/health >nul 2>&1
if not errorlevel 1 (echo   OCR Service:  [OK] healthy) else (echo   OCR Service:  [DOWN])
curl -sf http://localhost:4387/api/config >nul 2>&1
if not errorlevel 1 (echo   Backend API:  [OK] healthy) else (echo   Backend API:  [DOWN])
curl -sf http://localhost/ >nul 2>&1
if not errorlevel 1 (echo   Frontend:     [OK] healthy) else (echo   Frontend:     [DOWN])
curl -sf http://127.0.0.1:11434/api/version >nul 2>&1
if not errorlevel 1 (echo   Ollama LLM:   [OK] running) else (echo   Ollama LLM:   [--] not running (optional^))
goto :eof

:: ── UPDATE ────────────────────────────────────────────────────────────
:update
echo Updating MedOCR...
git pull --ff-only
echo Pulling latest images...
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
echo [OK] Updated and restarted
goto :eof

:: ── USAGE ─────────────────────────────────────────────────────────────
:usage
echo Usage: medocr.bat [start ^| stop ^| logs ^| status ^| update]
echo.
echo   start   - Start all MedOCR services (default)
echo   stop    - Stop all services
echo   logs    - View live service logs
echo   status  - Check health of all services
echo   update  - Pull latest code and restart
goto :eof
