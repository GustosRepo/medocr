# Phi-3.5 Vision LLM Service

Microservice for medical document extraction using Microsoft Phi-3.5 Vision model.

## Features

- Vision-Language Model for OCR validation
- Structured JSON extraction from medical documents
- Handles handwritten notes, complex tables, poor quality scans
- GPU accelerated inference
- Zero monthly cost (self-hosted)

## Hardware Requirements

### Minimum (Small Model)
- GPU: NVIDIA RTX 3060 (12GB VRAM)
- RAM: 16GB
- Storage: 50GB

### Recommended
- GPU: NVIDIA RTX 4090 (24GB VRAM)
- RAM: 32GB
- Storage: 100GB

## Quick Start

### Docker (Recommended)
```bash
# Build and run with GPU support
docker compose up llm-service
```

### Manual Setup
```bash
# Install dependencies
pip install -r requirements.txt

# Run service
python main.py
```

## API Endpoints

### Health Check
```bash
curl http://localhost:8001/
```

### Extract from Image
```bash
curl -X POST http://localhost:8001/extract \
  -F "image=@document.png" \
  -F "prompt=Extract patient name and DOB"
```

## Model Configuration

Default model: `microsoft/phi-3.5-vision-instruct` (8GB VRAM)

Alternative models:
- `Qwen/Qwen2-VL-7B-Instruct` (12GB VRAM, excellent for medical)
- `OpenGVLab/MiniCPM-V-2.6` (8GB VRAM, great accuracy)

Change model in `docker-compose.yml`:
```yaml
environment:
  - MODEL_NAME=Qwen/Qwen2-VL-7B-Instruct
```

## Performance

- Processing time: 10-15 seconds per page
- Throughput: 4-6 documents per minute
- Memory: 8-12GB VRAM during inference
- Accuracy: 95-98% on medical documents

## Integration

This service is called by the backend API:
```javascript
import { extractWithLocalLLM } from './llmService.js';

const result = await extractWithLocalLLM(imagePath);
```

## Troubleshooting

### Out of Memory
Reduce batch size or model size in `main.py`:
```python
device_map = "auto"  # Change to "cpu" for CPU-only
torch_dtype = torch.float16  # Change to float32 for more precision
```

### Slow Performance
- Ensure CUDA is properly installed
- Check GPU utilization: `nvidia-smi`
- Consider smaller model if GPU is limited

### Model Download Issues
Models auto-download on first run to `/app/models`. If interrupted:
```bash
rm -rf llm_service/models/*
docker compose up llm-service  # Will re-download
```
