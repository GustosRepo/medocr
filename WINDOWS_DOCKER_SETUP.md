# Windows Intel Docker Setup

## Quick Setup

**1. Install Ollama:**
- Download: https://ollama.com/download
- Run: `ollama pull llava-phi3 && ollama pull llama3.2:latest && ollama serve`

**2. Update your `.env` file:**
```env
ENABLE_LLM=true
OLLAMA_HOST=http://host.docker.internal:11434
OLLAMA_MODEL=llava-phi3
OLLAMA_TIMEOUT=120000
```

**3. Comment out the LLM service in `docker-compose.yml`:**

Find this section and comment it out:
```yaml
# llm:
#   image: medocr-llm:local
#   ... (entire llm service section)
```

**4. Run:**

```bash
docker-compose up -d
```

**That's it.** Docker will pull the images from `ghcr.io/gustosrepo/medocr-*:latest` automatically, and the backend will use Ollama on your Windows host.

---

## About the `medocr-llm-1` Error

**The error:**
```
pull access denied for medocr-llm
```

**Why it happens:** The `llm` service in `docker-compose.yml` requires NVIDIA GPU which you don't have.

**Solution:** Just ignore it. Comment out the LLM service (step 3 above) and the backend will use Ollama on your Windows host instead via `host.docker.internal:11434`.
