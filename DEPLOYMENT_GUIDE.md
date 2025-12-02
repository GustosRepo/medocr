# MEDOCR Deployment Guide

## Overview

This guide covers deploying MEDOCR v1.2.3+ using Docker images from GitHub Container Registry.

## Prerequisites

- Docker installed on target machine
- Internet connection to pull images from ghcr.io
- Ports available: 4387 (backend), 8000 (OCR), 5173 (frontend), 11434 (Ollama)

## Quick Start

### 1. Pull Docker Images

Pull the latest version:

```bash
docker pull ghcr.io/gustosrepo/medocr-ocr:latest
docker pull ghcr.io/gustosrepo/medocr-backend:latest
docker pull ghcr.io/gustosrepo/medocr-frontend:latest
```

Or pull a specific version:

```bash
docker pull ghcr.io/gustosrepo/medocr-ocr:v1.2.3
docker pull ghcr.io/gustosrepo/medocr-backend:v1.2.3
docker pull ghcr.io/gustosrepo/medocr-frontend:v1.2.3
```

### 2. Set Up Docker Compose

Create or update your `docker-compose.yml`:

```yaml
version: '3.8'

services:
  ocr:
    image: ghcr.io/gustosrepo/medocr-ocr:latest
    container_name: medocr-ocr
    ports:
      - "8000:8000"
    environment:
      - OCR_AUTO_DPI=1
      - OCR_BASE_DPI=300
      - OCR_MAX_DPI=600
    volumes:
      - ./data/ocr:/app/data
    restart: unless-stopped

  backend:
    image: ghcr.io/gustosrepo/medocr-backend:latest
    container_name: medocr-backend
    ports:
      - "4387:4387"
    environment:
      - NODE_ENV=production
      - OCR_SERVICE_URL=http://ocr:8000
      - OLLAMA_HOST=http://host.docker.internal:11434
    volumes:
      - ./data/backend:/app/data
      - ./data/uploads:/app/data/uploads
      - ./data/results:/app/data/results
    depends_on:
      - ocr
    restart: unless-stopped

  frontend:
    image: ghcr.io/gustosrepo/medocr-frontend:latest
    container_name: medocr-frontend
    ports:
      - "5173:80"
    environment:
      - VITE_API_URL=http://localhost:4387
    depends_on:
      - backend
    restart: unless-stopped
```

### 3. Install Ollama (Required)

Ollama is **not included** in Docker images and must be installed separately.

**Download and install:**
- Visit: https://ollama.com
- Download for your platform (Windows/Mac/Linux)
- Run installer

**Pull the vision model:**

```bash
ollama pull llava-phi3
```

**Verify Ollama is running:**

```bash
curl http://localhost:11434/api/version
```

For detailed Ollama setup, see [OLLAMA_SETUP_INSTRUCTIONS.md](./OLLAMA_SETUP_INSTRUCTIONS.md)

### 4. Start Services

```bash
docker-compose up -d
```

### 5. Verify Deployment

Check all services are running:

```bash
docker-compose ps
```

Test the backend:

```bash
curl http://localhost:4387/health
```

Test the OCR service:

```bash
curl http://localhost:8000/health
```

Access the frontend:

```
http://localhost:5173
```

## Updating to New Versions

### Pull Latest Images

```bash
docker-compose pull
docker-compose up -d
```

### Update to Specific Version

Edit `docker-compose.yml` and change image tags:

```yaml
services:
  ocr:
    image: ghcr.io/gustosrepo/medocr-ocr:v1.2.3
  backend:
    image: ghcr.io/gustosrepo/medocr-backend:v1.2.3
  frontend:
    image: ghcr.io/gustosrepo/medocr-frontend:v1.2.3
```

Then restart:

```bash
docker-compose up -d
```

## Data Persistence

Your data is stored in the following volumes:

```
./data/
├── backend/          # Backend application data
├── uploads/          # Uploaded PDF files
├── results/          # Extraction results (JSON)
├── ocr/             # OCR service data
└── logs/            # Application logs
```

**Important:** Always back up the `data/` directory before updating.

## Port Configuration

Default ports can be changed in `docker-compose.yml`:

| Service  | Default Port | Environment Variable |
|----------|--------------|---------------------|
| Frontend | 5173         | N/A (nginx config)  |
| Backend  | 4387         | PORT                |
| OCR      | 8000         | N/A (uvicorn)       |
| Ollama   | 11434        | OLLAMA_HOST         |

## Environment Variables

### Backend

- `NODE_ENV` - Set to `production`
- `OCR_SERVICE_URL` - URL to OCR service (default: `http://ocr:8000`)
- `OLLAMA_HOST` - URL to Ollama service (default: `http://host.docker.internal:11434`)
- `PORT` - Backend port (default: 4387)

### OCR Service

- `OCR_AUTO_DPI` - Enable automatic DPI adjustment (0 or 1, default: 1)
- `OCR_BASE_DPI` - Starting DPI for OCR (default: 300)
- `OCR_MAX_DPI` - Maximum DPI to try (default: 600)

### Frontend

- `VITE_API_URL` - Backend API URL (default: `http://localhost:4387`)

## Troubleshooting

### Images Won't Pull

If you get authentication errors:

```bash
# Log in to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

Or if images are public, try:

```bash
docker logout ghcr.io
docker pull ghcr.io/gustosrepo/medocr-ocr:latest
```

### Services Not Starting

Check logs:

```bash
docker-compose logs -f
```

Check individual service:

```bash
docker-compose logs backend
docker-compose logs ocr
docker-compose logs frontend
```

### Ollama Connection Issues

If backend can't reach Ollama:

**On Mac/Windows Docker Desktop:**
```yaml
environment:
  - OLLAMA_HOST=http://host.docker.internal:11434
```

**On Linux:**
```yaml
environment:
  - OLLAMA_HOST=http://172.17.0.1:11434
```

Or run Ollama in Docker:
```yaml
ollama:
  image: ollama/ollama:latest
  ports:
    - "11434:11434"
  volumes:
    - ollama_data:/root/.ollama
```

### Patient Names Not Extracting

This was fixed in v1.2.1+. If you see incorrect names like "Ease, Dis":

1. Verify you're running v1.2.3 or later:
   ```bash
   docker-compose images
   ```

2. Pull the latest images:
   ```bash
   docker-compose pull
   docker-compose up -d
   ```

3. Reprocess documents if needed

## Version History

### v1.2.3 (Latest)
- ✅ Fixed Docker image deployment to ghcr.io
- ✅ Resolves 2GB file size limit for OCR image
- ✅ Images now available at GitHub Container Registry

### v1.2.2
- ✅ Document hydration (persistence across restarts)
- ✅ Frontend route normalization
- ✅ Ollama setup documentation

### v1.2.1
- ✅ Patient name extraction fix (no more "Ease, Dis")
- ✅ Enhanced pattern matching with medical term filters
- ✅ Support for "Patient Information" headers

## Support

For issues or questions:
- GitHub Issues: https://github.com/GustosRepo/medocr/issues
- Check logs: `docker-compose logs -f`
- Review documentation in `/docs` folder

## Migration from v1.2.2 or Earlier

If you were using the old tar file deployment method:

### Old Method (No Longer Supported)
```bash
docker load -i medocr-ocr-amd64.tar
docker load -i medocr-backend-amd64.tar
docker load -i medocr-frontend-amd64.tar
```

### New Method (v1.2.3+)
```bash
docker pull ghcr.io/gustosrepo/medocr-ocr:latest
docker pull ghcr.io/gustosrepo/medocr-backend:latest
docker pull ghcr.io/gustosrepo/medocr-frontend:latest
```

Update your `docker-compose.yml` to use the new image names (see Quick Start section above).

## Production Checklist

- [ ] Ollama installed and llava-phi3 model downloaded
- [ ] Docker and Docker Compose installed
- [ ] Ports 4387, 8000, 5173, 11434 available
- [ ] `docker-compose.yml` configured with correct image versions
- [ ] Data directories created and permissions set
- [ ] Environment variables configured
- [ ] Services started: `docker-compose up -d`
- [ ] Health checks passing for all services
- [ ] Test document uploaded and processed successfully
- [ ] Patient names extracting correctly
- [ ] Backup strategy in place for `data/` directory
