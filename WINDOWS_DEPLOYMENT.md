# MEDOCR Windows Deployment Instructions

## Download Images

Download all three image files from the v1.0.1 release:
https://github.com/GustosRepo/medocr/releases/tag/v1.0.1

- `medocr-ocr-amd64.tar` (1.3 GB)
- `medocr-backend-amd64.tar` (1.72 GB)  
- `medocr-frontend-amd64.tar` (47.7 MB)

## Prerequisites

- Docker Desktop installed and running on Windows
- At least 5 GB free disk space

## Load Images

Open PowerShell or Command Prompt and navigate to the folder containing the downloaded `.tar` files.

Load each image:

```bash
docker load -i medocr-ocr-amd64.tar
docker load -i medocr-backend-amd64.tar
docker load -i medocr-frontend-amd64.tar
```

Verify images are loaded:

```bash
docker images | findstr medocr
```

You should see three images:
- `medocr-ocr:amd64`
- `medocr-backend:amd64`
- `medocr-frontend:amd64`

## Run the Application

### 1. Create Docker Network

```bash
docker network create medocr-net
```

### 2. Start OCR Service

```bash
docker run -d --name ocr --network medocr-net -p 8000:8000 medocr-ocr:amd64
```

### 3. Start Backend API

```bash
docker run -d --name api --network medocr-net -p 4387:4387 -e OCR_SERVICE_URL=http://ocr:8000 medocr-backend:amd64
```

### 4. Start Frontend

```bash
docker run -d --name frontend --network medocr-net -p 80:80 medocr-frontend:amd64
```

## Access the Application

Open your web browser and go to:

```
http://localhost
```

The MEDOCR interface should load. You can upload medical referral images for OCR processing.

## Check Status

View running containers:

```bash
docker ps
```

Check logs if something isn't working:

```bash
docker logs api
docker logs ocr
docker logs frontend
```

## Stop the Application

```bash
docker stop frontend api ocr
docker rm frontend api ocr
```

## Troubleshooting

**Port conflicts**: If port 80 is already in use, you can run the frontend on a different port:

```bash
docker run -d --name frontend --network medocr-net -p 8080:80 medocr-frontend:amd64
```

Then access at `http://localhost:8080`

**Containers not communicating**: Ensure all three containers are on the same network (`medocr-net`) and were started in the correct order (OCR → Backend → Frontend).

**Upload size limits**: The backend supports files up to 50 MB by default.
