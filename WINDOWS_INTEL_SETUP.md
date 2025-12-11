# 🚀 Windows Intel Setup Guide

## For Intel Core Ultra 7 155H (32GB RAM)

This guide is optimized for Windows systems with Intel Core Ultra processors experiencing CPU timeout issues.

---

## Step 1: Install Ollama

1. Download Ollama for Windows: https://ollama.com/download
2. Run the installer
3. Restart your computer
4. Open **PowerShell** and verify:
   ```powershell
   ollama --version
   ```

---

## Step 2: Pull Optimized Models

Open **PowerShell** and run:

```powershell
# Pull AI analysis model (fast, 2GB)
ollama pull llama3.2:latest

# Pull optimized vision model (faster, 2.9GB)
ollama pull llava-phi3
```

**Why llava-phi3?**
- ✅ 38% smaller than llava:7b (2.9GB vs 4.7GB)
- ✅ Faster on Intel CPUs
- ✅ Built on Microsoft Phi-3 architecture
- ✅ Lower timeout risk
- ✅ Good quality for medical documents

---

## Step 3: Configure Environment

1. Navigate to your project folder
2. Open the `.env` file in a text editor (Notepad, VS Code, etc.)
3. Update these settings:

```bash
# LLM Configuration
ENABLE_LLM=true
LLM_MODE=extract
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=llava-phi3
OLLAMA_TIMEOUT=120000
LLM_TIMEOUT=300000
```

4. Save and close the file

---

## Step 4: Start the Application

Open **PowerShell** in your project folder and run:

```powershell
npm run dev:all
```

This will:
- Start Ollama service automatically
- Start the backend server
- Start the frontend UI
- Start the OCR service

---

## Step 5: Test It Out

1. Open your browser to: http://localhost:5173
2. Upload a medical document
3. Wait for processing (should complete in 30-60 seconds)
4. Check that:
   - ✅ OCR extraction completes
   - ✅ "Analyze with AI" button appears
   - ✅ Clinical problems are extracted
   - ✅ No timeout errors

---

## Troubleshooting

### If you still get timeout errors:

**Increase timeouts in `.env`:**
```bash
OLLAMA_TIMEOUT=180000  # 3 minutes
LLM_TIMEOUT=400000     # 6.5 minutes
```

Then restart:
```powershell
npm run dev:all
```

---

### If Ollama service won't start:

**Manually start Ollama:**
```powershell
# Terminal 1
ollama serve

# Terminal 2 (in project folder)
npm run dev:all
```

---

### If quality isn't good enough:

You can try the standard model (but it's slower):
```powershell
ollama pull llava:7b
```

Update `.env`:
```bash
OLLAMA_MODEL=llava:7b
OLLAMA_TIMEOUT=180000
LLM_TIMEOUT=400000
```

---

## Performance Expectations

**With llava-phi3 on your Intel Core Ultra 7:**
- AI Analysis: ~5-10 seconds per document
- OCR Extraction: ~30-60 seconds per document
- Total processing: ~45-75 seconds per document

**This is comparable to Mac performance!**

---

## Next Steps (If Still Having Issues)

If llava-phi3 still times out or quality isn't acceptable, we can implement **GPU acceleration with OpenVINO** (Intel's free AI toolkit).

Contact your developer if you need the GPU-accelerated setup.

---

## Quick Reference

**Models installed:**
- `llama3.2:latest` (2GB) - Text analysis
- `llava-phi3` (2.9GB) - Vision/OCR

**Key settings:**
- Model: `llava-phi3`
- Timeout: 120 seconds
- LLM Timeout: 300 seconds

**Start command:**
```powershell
npm run dev:all
```

**Check models:**
```powershell
ollama list
```

**Stop all services:**
```powershell
# Press Ctrl+C in the terminal running npm
```

---

**Need help?** Check the main `OLLAMA_SETUP_INSTRUCTIONS.md` for detailed troubleshooting.
