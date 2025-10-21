Colima / Docker instructions for medocr

This file documents how to build and run the medocr services using Colima (recommended on macOS) or Docker Desktop.

Prerequisites
- Colima installed (https://github.com/abiosoft/colima) and running. Colima provides a lightweight Linux VM on macOS.
- Docker CLI available (Colima sets this up for you).
- Sufficient CPU/RAM: OCR components (onnxruntime, opencv) can be memory/CPU intensive. Give Colima at least 4 CPUs and 8GB RAM for good behavior.

Quick start (Colima)
1. Start Colima (adjust CPUs/Memory as needed):

```bash
colima start --cpu 4 --memory 8192 --disk 60
```

2. Build and run via docker compose (uses the repository's compose file):

```bash
docker compose build
docker compose up -d
```

3. Health check the services:

```bash
curl http://localhost:4387/api/health
curl http://localhost:8000/health
# Frontend served on http://localhost:5173 or http://localhost:8080 depending on compose
```

Upload limits
- By default the backend will accept uploads without an explicit server-side size cap. To enforce an upload limit, set the environment variable `UPLOAD_MAX_BYTES` (e.g. 104857600 for 100MB) in your compose file or env file. Example:

```yaml
services:
  backend:
    environment:
      - UPLOAD_MAX_BYTES=104857600
```

Purge endpoint notes
- The backend's purge endpoint currently restricts purge requests to localhost to avoid accidental remote deletions. When running via Colima the frontend's browser requests may not appear as `127.0.0.1` from inside the container. If a purge request is rejected with 403, you have options:
  - Exec into the backend container and run curl from there (works as localhost):
    ```bash
    docker compose exec api sh -c "curl -X POST -H 'Content-Type: application/json' -d '{\"olderThan\": \"2025-01-01T00:00:00Z\"}' http://127.0.0.1:4387/api/documents/processed/purge"
    ```
  - Temporarily run the purge curl inside the colima VM or use SSH/local exec.

Windows notes
- Colima is macOS-focused; on Windows use Docker Desktop. The images and compose file are compatible with Docker Desktop.
- Make sure Docker Desktop has file sharing enabled for the project folder if you use bind mounts for `./data`.

Troubleshooting
- If the OCR container fails due to missing system libs, ensure the OCR Dockerfile installs poppler and tesseract (this repo Dockerfile does). If you need additional system packages, edit `ocr_service/Dockerfile`.
- If frontend assets are stale, rebuild with `cd frontend && npm run build` before building the Docker image.

If you'd like, I can:
- Add a small script `scripts/docker-build.sh` to automate building and pushing images.
- Remove the localhost-only purge guard and replace it with a short-lived token flow (requires changes to backend & UI).
- Add a `docker-compose.windows.yml` that uses named volumes instead of bind mounts for `data` to avoid Windows path sharing issues.
