# MedOCR — Setup & Usage Guide

Sleep study referral intake — upload PDFs, get structured data in seconds.

---

## What You Need

| Requirement | Status on your laptop |
|---|---|
| **Windows 11** (64-bit) | ✅ Windows 11 Home 24H2 |
| **Intel Core Ultra 7 155H** | ✅ 3.80 GHz — plenty fast |
| **32 GB RAM** | ✅ More than enough (16 GB is recommended) |
| **Docker Desktop** | Install once (see below) |
| **Ollama** | Install once (see below) |
| **Git for Windows** | Install once (see below) |
| **~15 GB free disk space** | For Docker images + AI models |

---

## One-Time Setup (15–20 minutes)

### 1. Install Docker Desktop

Download and install: https://www.docker.com/products/docker-desktop/

After installing, open Docker Desktop once so it finishes its setup. You'll see a whale icon in your system tray (bottom-right corner by the clock) when it's ready.

> If prompted about WSL 2, follow the instructions to enable it — Docker needs it on Windows.

### 2. Install Git for Windows

Download and install: https://git-scm.com/download/win

Use the default options during installation. This gives you Git Bash and adds `git` to your command line.

### 3. Install Ollama (recommended)

Download and install: https://ollama.com/download

After installing, open **PowerShell** (search "PowerShell" in the Start menu) and pull the AI models:

```powershell
ollama pull qwen2.5:14b
ollama pull qwen2.5vl:7b
```

The first model (~9 GB) reads text from OCR results. The second (~5 GB) reads images directly as a backup. This download only happens once.

> **Without Ollama:** MedOCR still works — it runs OCR and extracts data using pattern rules. Ollama adds the AI layer that dramatically improves accuracy for messy/handwritten referrals.

### 4. Clone the Repository

Open **PowerShell** and run:

```powershell
cd ~\Desktop
git clone https://github.com/GustosRepo/medocr.git
cd medocr
```

### 5. Create Your .env File

In the `medocr` folder, create a file named `.env` (no filename, just the extension) with this content:

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

> **Tip:** You can create this in Notepad — just make sure to save as "All Files" type and name it `.env` (not `.env.txt`). Or run this in PowerShell in the medocr folder:
> ```powershell
> notepad .env
> ```
> Paste the content above, save, and close.

### 6. First Launch

Double-click **medocr.bat** in the `medocr` folder, or open PowerShell and run:

```powershell
cd ~\Desktop\medocr
.\medocr.bat start
```

The first launch downloads the pre-built Docker images (~2 GB total). This only happens once — after that, starts take about 15 seconds.

Your browser will open automatically to **http://localhost** when it's ready.

---

## Daily Use

### Starting MedOCR

**Option A:** Double-click **medocr.bat** in your `Desktop\medocr` folder.

**Option B:** Open PowerShell and run:

```powershell
cd ~\Desktop\medocr
.\medocr.bat start
```

The script handles everything automatically:
- Starts Docker Desktop if it's not running
- Starts Ollama if it's installed but not running
- Launches all three services (OCR, API, Frontend)
- Opens your browser when everything is ready

### Stopping MedOCR

```powershell
cd ~\Desktop\medocr
.\medocr.bat stop
```

### Checking if Everything is Running

```powershell
.\medocr.bat status
```

Shows health indicators for each service.

### Viewing Logs (if something seems wrong)

```powershell
.\medocr.bat logs
```

Press `Ctrl+C` to stop watching logs.

---

## Processing Referrals

### Uploading Documents

1. Open **http://localhost** in your browser (Chrome, Edge, etc.)
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

```powershell
cd ~\Desktop\medocr
.\medocr.bat update
```

This pulls the latest code and images automatically. Your corrections and learned data are preserved.

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

Open **PowerShell** and run:

```powershell
# 1. Stop everything
cd ~\Desktop\medocr
.\medocr.bat stop

# 2. Pull latest code
git pull

# 3. Pull the new AI models
ollama pull qwen2.5:14b
ollama pull qwen2.5vl:7b

# 4. Remove old models to free up disk space (optional)
ollama rm llava:7b
ollama rm llava:13b
ollama rm llava-phi3

# 5. Update your .env file — replace any old model references with:
#    TEXT_MODEL=qwen2.5:14b
#    VLM_MODEL=qwen2.5vl:7b
#    OLLAMA_MODEL=qwen2.5vl:7b
#    TEXT_LLM=true
#    LEARN_ALL=true

# 6. Start fresh
.\medocr.bat start
```

> The Python `llm_service` folder is no longer used. Everything runs through Ollama now, which is simpler and faster.

---

## Troubleshooting

### MedOCR won't start

1. **Is Docker Desktop running?** Look for the whale icon in your system tray (bottom-right by the clock). If it's not there, open Docker Desktop from the Start menu.
2. **Try stopping and restarting:**
   ```powershell
   .\medocr.bat stop
   .\medocr.bat start
   ```

### "WSL 2" errors when starting Docker

Docker on Windows needs WSL 2. If you see errors about it:
1. Open PowerShell **as Administrator**
2. Run: `wsl --install`
3. Restart your computer
4. Open Docker Desktop again

### Results are inaccurate or processing is slow

- Run `.\medocr.bat status` and check that **Ollama LLM** shows as "running"
- If Ollama is not running, open PowerShell and run `ollama serve`, then reprocess
- Very blurry or handwritten documents may need manual corrections — this is normal

### "Can't connect to localhost"

- Run `.\medocr.bat status` to see which services are up
- If something is down: `.\medocr.bat stop` then `.\medocr.bat start`
- Try `http://localhost` or `http://127.0.0.1` directly in the browser address bar
- Check Windows Firewall isn't blocking Docker

### Upload won't go through

- Maximum file size: **50 MB**
- Maximum pages: **30 per PDF**
- Only **PDF** files are supported for the full pipeline

### Starting completely fresh

```powershell
.\medocr.bat stop
docker compose down -v
.\medocr.bat start
```

> ⚠️ **Warning:** `docker compose down -v` erases all processed documents and learned corrections. Only do this if you want a completely clean start.

---

## Quick Reference

| What you want to do | Command |
|---|---|
| **Start MedOCR** | Double-click `medocr.bat` or `.\medocr.bat start` |
| **Stop MedOCR** | `.\medocr.bat stop` |
| **Check health** | `.\medocr.bat status` |
| **View logs** | `.\medocr.bat logs` |
| **Update to latest version** | `.\medocr.bat update` |
| **Open in browser** | http://localhost |
