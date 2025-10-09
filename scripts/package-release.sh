#!/usr/bin/env bash
set -euo pipefail

# Package offline release tarballs for client (Option B)
# Usage:
#   ./scripts/package-release.sh 0.1.0
# Outputs:
#   dist/medocr-api-<ver>.tar
#   dist/medocr-frontend-<ver>.tar
#   dist/medocr-ocr-<ver>.tar
#   dist/compose.release.yml (copied)
#   dist/README_OFFLINE.md quick instructions

VER=${1:-0.1.0}
IMAGES=(api frontend ocr)
DIST=dist
mkdir -p "$DIST"

# Ensure buildx builder (multi-arch) exists
if ! docker buildx inspect medocr-builder >/dev/null 2>&1; then
  docker buildx create --name medocr-builder --use >/dev/null
fi

echo "Building images for linux/amd64 (version $VER) ..."
# Build each image and load into local docker (so we can docker save)
for svc in "${IMAGES[@]}"; do
  case $svc in
    api)
      docker buildx build --platform linux/amd64 -t medocr-api:"$VER" -f Dockerfile.api . --load;;
    frontend)
      docker buildx build --platform linux/amd64 -t medocr-frontend:"$VER" -f ./frontend/Dockerfile.frontend ./frontend --load;;
    ocr)
      docker buildx build --platform linux/amd64 -t medocr-ocr:"$VER" -f ocr_service/Dockerfile.ocr . --load;;
  esac
done

echo "Saving tarballs ..."
for name in medocr-api medocr-frontend medocr-ocr; do
  docker save -o "$DIST/${name}-${VER}.tar" "${name}:${VER}"
  gzip -f "$DIST/${name}-${VER}.tar"
  echo "Created $DIST/${name}-${VER}.tar.gz"
done

# Copy release compose (swap tags)
cp compose.release.yml "$DIST/compose.release.yml"
sed -i '' "s/medocr-api:0.1.0/medocr-api:${VER}/g; s/medocr-frontend:0.1.0/medocr-frontend:${VER}/g; s/medocr-ocr:0.1.0/medocr-ocr:${VER}/g" "$DIST/compose.release.yml" 2>/dev/null || \
perl -pi -e "s/medocr-api:0.1.0/medocr-api:${VER}/; s/medocr-frontend:0.1.0/medocr-frontend:${VER}/; s/medocr-ocr:0.1.0/medocr-ocr:${VER}/" "$DIST/compose.release.yml"

cat > "$DIST/README_OFFLINE.md" <<'EOF'
# MEDOCR Offline Deployment

Files:
- medocr-api-<ver>.tar.gz
- medocr-frontend-<ver>.tar.gz
- medocr-ocr-<ver>.tar.gz
- compose.release.yml
- .env (provide separately)

Steps (Windows PowerShell):
1. Extract tar.gz files (7zip or built-in) to .tar in same folder.
2. Load images:
   docker load -i medocr-api-<ver>.tar
   docker load -i medocr-frontend-<ver>.tar
   docker load -i medocr-ocr-<ver>.tar
3. Verify: docker images | findstr medocr
4. Place .env and compose.release.yml together.
5. Run: docker compose -f compose.release.yml --env-file .env up -d
6. Open http://localhost:8080

Update: repeat load with new version tarballs, then: docker compose pull (or just up -d with new tags).
EOF

echo "Done. Artifacts in $DIST"
