# MEDOCR - Medical Document OCR System

MEDOCR is a containerized medical document processing application that uses AI-powered OCR to extract and structure information from medical referral forms and documents.

## System Requirements

- **Windows 10/11** (64-bit)
- **Docker Desktop** for Windows
- **Minimum 8 GB RAM**
- **5 GB free disk space** for Docker images
- **Internet connection** for initial download

## Quick Start

### Step 1: Install Docker Desktop

1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop/
2. Run the installer and follow the prompts
3. Restart your computer if prompted
4. Launch Docker Desktop and wait for it to start (whale icon in system tray)

### Step 2: Download MEDOCR Images

Download all three image files from the latest release:

**Release URL:** https://github.com/GustosRepo/medocr/releases/tag/v1.0.1

Download these files:
- `medocr-ocr-amd64.tar` (1.3 GB)
- `medocr-backend-amd64.tar` (1.72 GB)
- `medocr-frontend-amd64.tar` (47.7 MB)

**Total download size:** ~3 GB

### Step 3: Load Docker Images

Open **PowerShell** or **Command Prompt** and navigate to your downloads folder:

```bash
cd Downloads
```

Load each image (this takes a few minutes):

```bash
docker load -i medocr-ocr-amd64.tar
docker load -i medocr-backend-amd64.tar
docker load -i medocr-frontend-amd64.tar
```

Verify the images loaded successfully:

```bash
docker images
```

You should see three `medocr-*:amd64` images listed.

### Step 4: Start MEDOCR

Create the Docker network:

```bash
docker network create medocr-net
```

Start the services in this order:

**1. OCR Service:**
```bash
docker run -d --name ocr --network medocr-net -p 8000:8000 -e MEDOCR_RENDER_DPI=300 -e MEDOCR_DOWNSAMPLE_PAGES=4 -e MEDOCR_DOWNSAMPLE_PAGES_HIGH=8 -e MEDOCR_DOWNSAMPLE_SCALE=0.5 -e MEDOCR_DOWNSAMPLE_SCALE_HIGH=0.4 -e MEDOCR_PREPROCESS_MODE=enhanced medocr-ocr:amd64
```

**2. Backend API:**
```bash
docker run -d --name api --network medocr-net -p 4387:4387 -e OCR_SERVICE_URL=http://ocr:8000 -e OCR_TIMEOUT_MS=900000 -e OCR_MAX_CONCURRENCY=4 -e DOC_MAX_CONCURRENCY=2 -e MAX_PDF_PAGES=150 -e UPLOAD_MAX_BYTES=52428800 -e RATE_WINDOW_MS=60000 -e RATE_MAX=500 medocr-backend:amd64
```

**3. Frontend Web Interface:**
```bash
docker run -d --name frontend --network medocr-net -p 80:80 medocr-frontend:amd64
```

### Step 5: Access MEDOCR

Open your web browser and go to:

```
http://localhost
```

The MEDOCR interface should load. You're ready to process documents!

## Using MEDOCR

### Processing Documents

1. Click **"Choose File"** or drag and drop your medical document image
2. Supported formats: **JPG, PNG, PDF** (up to 50 MB)
3. Click **"Upload and Process"**
4. Wait for processing to complete (may take 1-2 minutes for large PDFs)
5. Review the extracted data in structured format
6. Download results as **JSON** if needed

**Note:** The system is configured to handle:
- Files up to **50 MB** in size
- PDFs up to **150 pages**
- Up to **500 requests per minute**
- **15 minute timeout** for complex documents

### Managing Processed Documents

- **View History:** All processed documents appear in the list below the upload area
- **Export Data:** Click **"Export All as JSON"** to download all processed records
- **Clear History:** Click **"Purge All Records"** to delete all stored documents (cannot be undone)

## Managing the Application

### Check Status

See if containers are running:

```bash
docker ps
```

All three containers (`frontend`, `api`, `ocr`) should show status "Up".

### View Logs

If something isn't working, check the logs:

```bash
docker logs api
docker logs ocr
docker logs frontend
```

### Stop MEDOCR

```bash
docker stop frontend api ocr
```

### Start MEDOCR Again

```bash
docker start ocr
docker start api
docker start frontend
```

Then access at `http://localhost`

### Remove MEDOCR

To completely remove (you'll need to reload images to use again):

```bash
docker stop frontend api ocr
docker rm frontend api ocr
docker network rm medocr-net
docker rmi medocr-frontend:amd64 medocr-backend:amd64 medocr-ocr:amd64
```

## Troubleshooting

### Port 80 Already in Use

If you get an error that port 80 is already in use, run the frontend on a different port:

```bash
docker stop frontend
docker rm frontend
docker run -d --name frontend --network medocr-net -p 8080:80 medocr-frontend:amd64
```

Then access at: `http://localhost:8080`

### Containers Not Starting

1. Make sure Docker Desktop is running (whale icon in system tray)
2. Check if other applications are using the required ports
3. Try restarting Docker Desktop
4. Check logs with `docker logs <container-name>`

### Upload Fails

- Maximum file size is **50 MB**
- Ensure file is a valid image (JPG, PNG) or PDF
- Check that all three containers are running: `docker ps`

### Poor OCR Results

- Ensure document image is clear and high resolution (minimum 300 DPI recommended)
- Avoid blurry or low-quality scans
- Make sure text is not rotated or skewed

### Cannot Connect to http://localhost

1. Verify frontend container is running: `docker ps | findstr frontend`
2. Check if port 80 is accessible: try `http://localhost:80`
3. Try accessing via IP: `http://127.0.0.1`
4. Check Windows Firewall isn't blocking Docker

## Technical Details

- **OCR Engine:** RapidOCR (CPU-based, no GPU required)
- **Backend:** Node.js REST API
- **Frontend:** React web application
- **Data Storage:** Local JSON file (persists between restarts)
- **Network:** All services communicate via `medocr-net` Docker network

## Support

For issues or questions, contact your system administrator or check the application logs using the commands above.

## Data Privacy

- All processing happens **locally on your computer**
- **No data is sent to external servers**
- Documents and extracted data are stored in Docker containers
- Data persists until you manually purge it or remove the containers

## Updates

To update to a newer version:

1. Download new `.tar` files from the release page
2. Stop and remove existing containers
3. Remove old images: `docker rmi medocr-frontend:amd64 medocr-backend:amd64 medocr-ocr:amd64`
4. Load new images following Step 3
5. Start containers following Step 4

---

**Version:** 1.0.1  
**Last Updated:** October 2025  
**Platform:** Windows x64 with Docker Desktop
