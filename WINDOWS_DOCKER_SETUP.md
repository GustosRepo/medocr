# Windows Intel Docker Setup

## Quick Setup

**1. Install Ollama:**
- Download: https://ollama.com/download
- Pull models: `ollama pull llava-phi3 && ollama pull llama3.2:latest`

**2. Enable GPU Acceleration (Intel Arc):**

Your Intel Core Ultra 7 155H has an Intel Arc GPU. Enable it:

```powershell
# Set environment variables for GPU
$env:ONEAPI_DEVICE_SELECTOR="level_zero:gpu"
$env:OLLAMA_NUM_GPU=1

# Start Ollama with GPU support
ollama serve
```

**Verify GPU is working:**
```powershell
# In another PowerShell window:
ollama run llava-phi3 "test"
```
Open Task Manager → Performance → GPU. You should see GPU usage spike, not CPU.

**3. Update your `.env` file:**
```env
ENABLE_LLM=true
OLLAMA_HOST=http://host.docker.internal:11434
OLLAMA_MODEL=llava-phi3
OLLAMA_TIMEOUT=120000
LLM_TIMEOUT=300000
```

**4. Comment out the LLM service in `docker-compose.yml`:**

Find this section and comment it out:
```yaml
# llm:
#   image: medocr-llm:local
#   ... (entire llm service section)
```

**5. Run:**

```bash
docker-compose up -d
```

**That's it.** Docker will pull the images from `ghcr.io/gustosrepo/medocr-*:latest` automatically, and the backend will use Ollama on your Windows host with GPU acceleration.

---

## Troubleshooting GPU

**If still timing out:**

1. **Check GPU is detected:**
```powershell
# Ollama should show GPU info on startup
ollama serve
# Look for "Intel Arc" or "GPU 0" in output
```

2. **Increase timeouts further:**
```env
OLLAMA_TIMEOUT=300000
LLM_TIMEOUT=600000
```

3. **Try smaller model (faster):**
```powershell
ollama pull llama3.2:1b
```
Update `.env`: `OLLAMA_MODEL=llama3.2:1b`

4. **Check Windows GPU drivers:**
- Update Intel Arc drivers: https://www.intel.com/content/www/us/en/download/785597/intel-arc-iris-xe-graphics-windows.html

---

## About the `medocr-llm-1` Error

**The error:**
```
pull access denied for medocr-llm
```

**Why it happens:** The `llm` service in `docker-compose.yml` requires NVIDIA GPU which you don't have.

**Solution:** Just ignore it. Comment out the LLM service (step 3 above) and the backend will use Ollama on your Windows host instead via `host.docker.internal:11434`.
