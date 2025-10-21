#!/usr/bin/env bash
# Build release images for local (arm64) and save tarballs for distribution
# Usage: ./scripts/release-build-local.sh [output-dir]
set -euo pipefail
OUT_DIR=${1:-./release}
mkdir -p "$OUT_DIR"

echo "Ensure docker & buildx are available. If using Colima, make sure it's started."
# Services to build in 'name:context' pairs for macOS bash compatibility
SERVICES=(
  "backend:./backend"
  "ocr:./ocr_service"
  "frontend:./frontend"
)

# Determine which container CLI to use: docker (preferred) or colima/nerdctl
USE_DOCKER=0
USE_NERDCTL=0
if command -v docker >/dev/null 2>&1 && docker --version >/dev/null 2>&1; then
  USE_DOCKER=1
elif command -v colima >/dev/null 2>&1 && colima nerdctl --help >/dev/null 2>&1; then
  USE_NERDCTL=1
elif command -v nerdctl >/dev/null 2>&1; then
  USE_NERDCTL=1
else
  echo "Neither docker nor colima/nerdctl found. Start Colima or install Docker Desktop." >&2
  exit 1
fi

# Ensure buildx builder exists when using docker
if [ "$USE_DOCKER" -eq 1 ]; then
  if ! docker buildx inspect multi-builder >/dev/null 2>&1; then
    echo "Creating buildx builder 'multi-builder'..."
    docker buildx create --name multi-builder --use || true
  fi
  # Optional: register QEMU emulation (if you haven't already)
  # docker run --rm --privileged tonistiigi/binfmt:latest --install all || true
fi

# Services to build
declare -A SERVICES=(
  [backend]=./backend
  [ocr]=./ocr_service
  [frontend]=./frontend
)

for pair in "${SERVICES[@]}"; do
  name=${pair%%:*}
  context=${pair#*:}
  tag="medocr-${name}:local"
  tarfile="${OUT_DIR}/medocr-${name}-local.tar"

  echo "Building ${name} (${tag}) for local platform (arm64)..."
  if [ "$USE_DOCKER" -eq 1 ]; then
    docker buildx build --platform linux/arm64 -t "${tag}" --load "$context"
  else
    # Use colima/nerdctl
    if command -v colima >/dev/null 2>&1 && colima nerdctl --help >/dev/null 2>&1; then
      NCTL=(colima nerdctl)
    else
      NCTL=(nerdctl)
    fi
    "${NCTL[@]}" build --platform linux/arm64 -t "${tag}" "$context"
  fi

  echo "Saving ${tag} -> ${tarfile}"
  if [ "$USE_DOCKER" -eq 1 ]; then
    docker save "${tag}" -o "${tarfile}"
  else
    "${NCTL[@]}" image save -o "${tarfile}" "${tag}"
  fi

  echo "Built and saved ${tarfile}"
done

echo "All images built and saved in ${OUT_DIR}" 

cat <<EOF
Next steps (on your machine):
# To load the images:
# docker load -i release/medocr-backend-local.tar
# docker load -i release/medocr-ocr-local.tar
# docker load -i release/medocr-frontend-local.tar
# Then run compose pointing to docker-compose.images.yml
EOF
