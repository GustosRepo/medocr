# MedOCR — Setup & Usage Guide

Sleep study referral intake — upload PDFs, get structured data in seconds.

---

## What You Need

| Requirement | Why |
|---|---|
| **Mac** (Apple Silicon M1–M4) | Runs OCR + AI locally |
| **Docker Desktop** | Runs the 3 services (OCR, API, Frontend) |
| **Ollama** *(recommended)* | Runs the AI models that read your PDFs |
| **16 GB+ RAM** | 8 GB minimum, 16+ recommended for LLM |
| **~15 GB disk space** | Docker images + AI models |

---

## One-Time Setup (15–20 minutes)

### 1. Install Docker Desktop

Download and install: https://www.docker.com/products/docker-desktop/

After installing, open Docker Desktop once so it finishes its setup. You'll see a whale icon in your menu bar when it's ready.

### 2. Install Ollama (recommended)

Download and install: https://ollama.com/download

Then open Terminal and pull the AI models:

```bash
ollama pull qwen2.5:14b
ollama pull qwen2.5vl:7b
```

The first model (~9 GB) reads text from OCR results. The second (~5 GB) reads images directly as a backup. This download only happens once.

> **Without Ollama:** MedOCR still works — it runs OCR and extracts data using pattern rules. Ollama adds the AI layer that dramatically improves accuracy for messy/handwritten referrals.

### 3. Clone the Repository

Open **Terminal** (search "Terminal" in Spotlight or find it in Applications → Utilities) and run:

```bash
cd ~/Desktop
git clone https://github.com/GustosRepo/medocr.git
cd medocr
```

### 4. Create Your .env File

Copy the example environment file:

```bash
cp .env.example .env
```

If there's no `.env.example`, create a file named `.env` in the `medocr` folder with this content:

```env
NODE_ENV=production
PORT=4387

# OCR
OCR_SERVICE_URL=http://ocr:8000
OCR_TIMEOUT_MS=120000
OCR_MAX_CONCURRENCY=2
MAX_PDF_PAGES=30

# AI Pipeline
TEXT_LLM=true
TEXT_MODEL=qwen2.5:14b
TEXT_LLM_MAX_PAGES=8
VLM_MODEL=qwen2.5vl:7b
VLM_MAX_PAGES=6
OLLAMA_HOST=http://host.docker.internal:11434

# Learning — save all corrections locally to improve accuracy over time
LEARN_ALL=true
```

### 5. First Launch

```bash
chmod +x medocr.sh
./medocr.sh start
```

The first launch takes a few minutes because Docker needs to build the images. After that, starts take about 15 seconds.

Your browser will open automatically to **http://localhost** when it's ready.

---

## Daily Use

### Starting MedOCR

Open **Terminal** and run:

```bash
cd ~/Desktop/medocr
./medocr.sh start
```

The script handles everything automatically:
- Starts Docker Desktop if it's not running
- Starts Ollama if it's installed but not running
- Launches all three services (OCR, API, Frontend)
- Opens your browser when everything is ready

### Stopping MedOCR

```bash
cd ~/Desktop/medocr
./medocr.sh stop
```

### Checking if Everything is Running

```bash
./medocr.sh status
```

You'll see green or red indicators for each service.

---

## Processing Referrals

### Uploading Documents

1. Open **http://localhost** in your browser (Safari, Chrome, etc.)
2. Click **"Choose files"** or drag-and-drop one or more PDFs
3. Processing starts automatically — typically **10–20 seconds** per document

### Reviewing Results

After processing, the extracted data appears organized into sections:

| Section | What's in it |
|---|---|
| **Patient** | Name, DOB, phone, email |
| **Procedure** | CPT code and description |
| **Insurance** | Carrier, member ID, group ID |
| **Clinical** | Primary diagnosis (ICD-10), symptoms, vitals |
| **Referring Physician** | Name, NPI, phone, fax, practice |
| **Information Alerts** | PPE, safety, accommodations |
| **Problem Flags** | Items that need manual attention |

### Editing & Correcting Results

If something was extracted incorrectly:

1. Click the **"Edit & Save Corrections"** button on any result card
2. Fix whatever fields are wrong — you can edit anything: patient name, DOB, CPT code, provider info, insurance, etc.
3. Click **"Save Corrections"**

**Every correction you make teaches the system.** The next time MedOCR sees the same provider name, carrier spelling, or pattern, it uses your correction automatically. The more you use it, the better it gets.

### Generating a Summary PDF

Click the **PDF icon** on a result card to generate a clean one-page summary you can print or save to the patient's file.

### Using the Checklist

Click **"Checklist"** in the sidebar to see all processed documents as a task list. You can:

- **Filter** by insurance carrier using the dropdown
- **Mark items** as complete with the checkboxes
- **Add notes** to any item
- **Print** a filtered view for your records
- **Archive** completed items to keep your list clean

---

## Updating MedOCR

When a new version is available:

```bash
cd ~/Desktop/medocr
./medocr.sh update
```

This pulls the latest code and rebuilds automatically. Your corrections and learned data are preserved.

---

## Migrating from the Old Setup

If you were running an older version of MedOCR with `llava`, `llava-phi3`, or the Python LLM service, here's what changed:

**Old models (no longer used):**
- `llava:7b` / `llava:13b`
- `llava-phi3`
- `microsoft/phi-3.5-vision-instruct` (the Python LLM service)

**New models (much faster and more accurate):**
- `qwen2.5:14b` — text extraction (reads OCR output)
- `qwen2.5vl:7b` — vision fallback (reads page images directly)

### Steps to migrate:

```bash
# 1. Stop everything
cd ~/Desktop/medocr
./medocr.sh stop

# 2. Pull latest code
git pull

# 3. Pull the new AI models
ollama pull qwen2.5:14b
ollama pull qwen2.5vl:7b

# 4. Remove old models to free up disk space (optional)
ollama rm llava:7b
ollama rm llava:13b
ollama rm llava-phi3

# 5. Update your .env file — replace any old model references:
#    TEXT_MODEL=qwen2.5:14b
#    VLM_MODEL=qwen2.5vl:7b
#    OLLAMA_MODEL=qwen2.5vl:7b
#    TEXT_LLM=true
#    LEARN_ALL=true

# 6. Start fresh
./medocr.sh start
```

> The Python `llm_service` folder is no longer used. Everything runs through Ollama now, which is simpler and faster.

---

## Troubleshooting

### MedOCR won't start

1. **Is Docker Desktop running?** Look for the whale icon in your menu bar. If it's not there, open Docker Desktop from your Applications folder.
2. **Try stopping and restarting:**
   ```bash
   ./medocr.sh stop
   ./medocr.sh start
   ```

### Results are inaccurate or processing is slow

- Run `./medocr.sh status` and check that **Ollama LLM** shows as "running"
- If Ollama is "not running", open Terminal and run `ollama serve`, then try reprocessing
- Very blurry or handwritten documents may need manual corrections — this is normal

### "Can't connect to localhost"

- Run `./medocr.sh status` to see which services are up
- If something is down: `./medocr.sh stop` then `./medocr.sh start`
- Try typing `http://localhost` or `http://127.0.0.1` directly in the browser address bar

### Upload won't go through

- Maximum file size: **50 MB**
- Maximum pages: **30 per PDF**
- Only **PDF** files are supported for the full pipeline

### Starting completely fresh

```bash
./medocr.sh stop
docker compose down -v
./medocr.sh start
```

> ⚠️ **Warning:** `docker compose down -v` erases all processed documents and learned corrections. Only do this if you want a completely clean start.

---

## Quick Reference

| What you want to do | Command |
|---|---|
| **Start MedOCR** | `./medocr.sh start` |
| **Stop MedOCR** | `./medocr.sh stop` |
| **Check health** | `./medocr.sh status` |
| **View logs** | `./medocr.sh logs` |
| **Update to latest version** | `./medocr.sh update` |
| **Open in browser** | http://localhost |
