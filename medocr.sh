#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  MedOCR — One-command launcher for sleep referral intake
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

NC='\033[0m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'

banner() {
  echo ""
  echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║${NC}        ${GREEN}MedOCR${NC}  —  Referral Intake System       ${CYAN}║${NC}"
  echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
  echo ""
}

check_docker() {
  if ! command -v docker &>/dev/null; then
    echo -e "${RED}✘ Docker is not installed.${NC}"
    echo "  Install Docker Desktop from: https://www.docker.com/products/docker-desktop/"
    exit 1
  fi
  if ! docker info &>/dev/null 2>&1; then
    echo -e "${YELLOW}⏳ Docker Desktop is not running. Starting it...${NC}"
    open -a Docker 2>/dev/null || true
    echo "  Waiting for Docker to start (this may take 30-60 seconds)..."
    local tries=0
    while ! docker info &>/dev/null 2>&1; do
      sleep 3
      tries=$((tries + 1))
      if [ "$tries" -gt 40 ]; then
        echo -e "${RED}✘ Docker did not start in time. Please open Docker Desktop manually and try again.${NC}"
        exit 1
      fi
    done
    echo -e "${GREEN}✓ Docker is ready${NC}"
  fi
}

check_ollama() {
  if command -v ollama &>/dev/null; then
    if curl -sf http://127.0.0.1:11434/api/version &>/dev/null; then
      echo -e "${GREEN}✓ Ollama is running (dual-engine LLM mode available)${NC}"
    else
      echo -e "${YELLOW}⚠ Ollama is installed but not running. Starting it...${NC}"
      ollama serve &>/dev/null &
      sleep 2
      if curl -sf http://127.0.0.1:11434/api/version &>/dev/null; then
        echo -e "${GREEN}✓ Ollama started${NC}"
      else
        echo -e "${YELLOW}⚠ Could not start Ollama — OCR-only mode will be used${NC}"
      fi
    fi
  else
    echo -e "${YELLOW}ℹ Ollama not installed — running in OCR-only mode (still accurate, just no LLM cross-check)${NC}"
  fi
}

start() {
  banner
  echo -e "${CYAN}[1/3]${NC} Checking prerequisites..."
  check_docker
  check_ollama

  echo ""
  echo -e "${CYAN}[2/3]${NC} Starting MedOCR services..."
  docker compose up -d --build --remove-orphans 2>&1 | while IFS= read -r line; do
    echo "  $line"
  done

  echo ""
  echo -e "${CYAN}[3/3]${NC} Waiting for services to be healthy..."
  local tries=0
  while true; do
    if curl -sf http://localhost:4387/api/config &>/dev/null; then
      break
    fi
    sleep 2
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      echo -e "${RED}✘ Backend did not become healthy. Check logs with: docker compose logs api${NC}"
      exit 1
    fi
  done

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  ✓ MedOCR is ready!${NC}"
  echo ""
  echo -e "  Open your browser to:  ${CYAN}http://localhost${NC}"
  echo ""
  echo -e "  Upload PDFs and results appear automatically."
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo ""

  # Open browser automatically on macOS
  if [[ "$OSTYPE" == "darwin"* ]]; then
    open "http://localhost" 2>/dev/null || true
  fi
}

stop() {
  echo -e "${YELLOW}Stopping MedOCR...${NC}"
  docker compose down
  echo -e "${GREEN}✓ MedOCR stopped${NC}"
}

logs() {
  docker compose logs -f --tail=100
}

status() {
  echo -e "${CYAN}MedOCR Service Status:${NC}"
  docker compose ps
  echo ""
  
  # Health checks
  if curl -sf http://localhost:8000/health &>/dev/null; then
    echo -e "  OCR Service:  ${GREEN}● healthy${NC}"
  else
    echo -e "  OCR Service:  ${RED}● down${NC}"
  fi
  
  if curl -sf http://localhost:4387/api/config &>/dev/null; then
    echo -e "  Backend API:  ${GREEN}● healthy${NC}"
  else
    echo -e "  Backend API:  ${RED}● down${NC}"
  fi
  
  if curl -sf http://localhost/ &>/dev/null; then
    echo -e "  Frontend:     ${GREEN}● healthy${NC}"
  else
    echo -e "  Frontend:     ${RED}● down${NC}"
  fi
  
  if curl -sf http://127.0.0.1:11434/api/version &>/dev/null; then
    echo -e "  Ollama LLM:   ${GREEN}● running${NC}"
  else
    echo -e "  Ollama LLM:   ${YELLOW}● not running (optional)${NC}"
  fi
}

update() {
  echo -e "${CYAN}Updating MedOCR...${NC}"
  git pull --ff-only
  docker compose up -d --build --remove-orphans
  echo -e "${GREEN}✓ Updated and restarted${NC}"
}

# ── Main ──────────────────────────────────────────────────────────────
case "${1:-start}" in
  start)  start  ;;
  stop)   stop   ;;
  logs)   logs   ;;
  status) status ;;
  update) update ;;
  *)
    echo "Usage: $0 {start|stop|logs|status|update}"
    echo ""
    echo "  start   — Build and launch all services (default)"
    echo "  stop    — Stop all services"
    echo "  logs    — Tail live logs from all services"
    echo "  status  — Check health of all services"
    echo "  update  — Pull latest code and rebuild"
    exit 1
    ;;
esac
