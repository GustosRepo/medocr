# Dual-Engine OCR + AI Implementation

## Overview

This branch implements a **dual-engine document processing system** that combines PaddleOCR with Microsoft Phi-3.5 Vision LLM for enhanced medical document extraction accuracy.

### Architecture

```
┌─────────────┐
│   PDF Upload│
└──────┬──────┘
       │
       ├──────────────────────┐
       │                      │
       ▼                      ▼
┌─────────────┐        ┌──────────────┐
│  PaddleOCR  │        │  Phi-3.5 LLM │
│  (OCR Text) │        │ (Vision + AI)│
└──────┬──────┘        └──────┬───────┘
       │                      │
       └──────────┬───────────┘
                  │
           (Parallel Processing)
                  │
                  ▼
        ┌─────────────────┐
        │ Conflict        │
        │ Resolution      │
        │ & Merge         │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Decision Tree   │
        │ Routing         │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Auto-Route      │
        │ to Workflow     │
        └─────────────────┘
```

## Why Dual-Engine?

Medical documents are challenging:
- **Multiple formats**: Handwritten notes, typed forms, scanned images, PDFs
- **Poor quality scans**: Faded text, skewed pages, low resolution
- **Complex layouts**: Tables, multi-column text, overlapping annotations
- **Medical terminology**: Abbreviations, drug names, diagnosis codes
- **Handwriting variations**: Different providers, rushed notes

**Single OCR engines miss too much.** Even with 85%+ confidence, critical fields can be wrong or empty.

### Solution: Dual Validation

1. **PaddleOCR**: Fast, efficient text extraction
2. **Phi-3.5 Vision**: Context-aware AI understanding
3. **Conflict Resolution**: Intelligent merging of results
4. **Decision Tree**: Automated routing based on quality

## Components

### Backend Services

#### 1. LLM Service (`llm_service/`)
- **Framework**: FastAPI + PyTorch + Transformers
- **Model**: microsoft/phi-3.5-vision-instruct (8GB VRAM)
- **Endpoints**:
  - `POST /extract` - Full document extraction
  - `POST /validate` - Compare OCR vs LLM results
  - `GET /health` - Service health check

#### 2. Dual-Engine Processor (`backend/utils/dualEngineProcessor.js`)
- Orchestrates parallel OCR + LLM processing
- Implements conflict resolution with 6 strategies:
  1. **Exact Match** - Values identical
  2. **Fuzzy Match** - 85%+ similarity (Levenshtein distance)
  3. **OCR Only** - LLM missed field
  4. **LLM Only** - OCR missed field
  5. **Field-Specific Rules** - Custom logic (dates, phones, IDs)
  6. **Conflict (Prefer LLM)** - Significant difference, default to AI

#### 3. Decision Tree Engine (`backend/decisionTree.js`)
- **5-Level Validation Pipeline**:
  1. **Completeness Check** - Required fields present?
  2. **Insurance Check** - Insurance info valid?
  3. **Clinical Check** - Diagnosis/referral reason present?
  4. **Provider Check** - Referring provider complete?
  5. **Demographics Check** - Patient address/contact complete?

- **Routing Actions** (Priority Order):
  1. `READY_TO_SCHEDULE` - All validations passed
  2. `INSURANCE_VERIFICATION` - Insurance needs verification
  3. `AUTHORIZATION_REQUEST` - Prior auth required
  4. `PROVIDER_FOLLOWUP` - Missing clinical info
  5. `MANUAL_REVIEW` - Multiple issues or low agreement

### Frontend Components

#### 1. DualEngineResults (`frontend/src/components/DualEngineResults.jsx`)
- Agreement score visualization (0-100%)
- Conflict display with side-by-side comparison
- Resolution reasoning and strategy badges
- Data quality grade (A-F)
- Expandable original results view

#### 2. DecisionTreeVisualization (`frontend/src/components/DecisionTreeVisualization.jsx`)
- Priority-based action cards
- 5-level validation pipeline status
- Next steps checklist
- Time estimates
- Urgency indicators

## Performance

### Processing Time
- **OCR**: 2-5 seconds
- **LLM**: 10-15 seconds
- **Total** (parallel): ~10-15 seconds
- **Merge + Decision Tree**: <1 second

### Hardware Requirements

**Minimum** (Testing):
- NVIDIA RTX 3060 (12GB VRAM)
- 16GB RAM
- 4-core CPU

**Recommended** (Production):
- NVIDIA RTX 4090 (24GB VRAM)
- 32GB RAM
- 8-core CPU

### Cost Analysis

**Self-Hosted** (This Implementation):
- GPU: $300-1600 one-time
- Electricity: ~$10/month
- API Costs: $0
- **Total**: ~$10/month after hardware purchase

**Cloud Alternative**:
- OpenAI GPT-4 Vision: $10-30/month (limited volume)
- Google Document AI: $1.50 per 1000 pages
- AWS Textract: $1.50 per 1000 pages

## Setup

### 1. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd frontend
npm install

# LLM Service
cd llm_service
pip install -r requirements.txt
```

### 2. Environment Variables

Add to `.env`:
```bash
# Enable LLM service
ENABLE_LLM=true
LLM_SERVICE_URL=http://llm:8001
LLM_TIMEOUT=30000

# Model configuration
MODEL_NAME=microsoft/phi-3.5-vision-instruct
DEVICE=cuda
TRANSFORMERS_CACHE=/app/models
```

### 3. Docker Compose

```bash
# Build all services
docker-compose build

# Start services
docker-compose up -d

# Check LLM service logs
docker-compose logs -f llm

# Verify GPU access
docker-compose exec llm nvidia-smi
```

### 4. Test Dual-Engine Processing

Upload a document through the frontend or API:

```bash
curl -X POST http://localhost:4387/api/documents \
  -F "file=@test_referral.pdf" \
  -H "Content-Type: multipart/form-data"
```

Check result for `dualEngine` field:
```json
{
  "dualEngine": {
    "mode": "ocr_llm_merged",
    "agreementScore": 92,
    "conflictCount": 2,
    "dataQuality": {
      "score": 88,
      "grade": "B",
      "level": "high"
    }
  },
  "routing": {
    "action": "READY_TO_SCHEDULE",
    "priority": 1,
    "nextSteps": [...]
  }
}
```

## Configuration Options

### LLM Model Alternatives

If Phi-3.5 doesn't work well for your documents, try:

1. **Qwen2-VL-7B** (12GB, best for medical)
   ```bash
   MODEL_NAME=Qwen/Qwen2-VL-7B-Instruct
   ```

2. **MiniCPM-V 2.6** (8GB, good balance)
   ```bash
   MODEL_NAME=openbmb/MiniCPM-V-2_6
   ```

3. **LLaVA-1.6** (13GB, strong vision)
   ```bash
   MODEL_NAME=liuhaotian/llava-v1.6-vicuna-13b
   ```

### Conflict Resolution Tuning

Edit `backend/utils/dualEngine.js`:

```javascript
// Adjust fuzzy match threshold (default: 85%)
const fuzzyThreshold = 80; // More lenient

// Add field-specific rules
fieldSpecificRules['patient.ssn'] = (ocr, llm) => {
  // Custom logic for SSN format
  const ocrDigits = ocr.replace(/\D/g, '');
  const llmDigits = llm.replace(/\D/g, '');
  
  if (ocrDigits.length === 9) return { resolved: ocr, confidence: 90 };
  if (llmDigits.length === 9) return { resolved: llm, confidence: 90 };
  
  return { resolved: llm, confidence: 50 };
};
```

### Decision Tree Customization

Edit `backend/decisionTree.js`:

```javascript
// Add custom validation level
checkCompliance(data) {
  const issues = [];
  
  // Check HIPAA compliance indicators
  if (!data.consentForm) {
    issues.push('HIPAA consent missing');
  }
  
  return {
    level: 6,
    name: 'Compliance Check',
    passed: issues.length === 0,
    issues,
    requiredAction: issues.length > 0 ? 'COMPLIANCE_REVIEW' : null
  };
}
```

## Monitoring

### Health Checks

```bash
# Overall system health
curl http://localhost:4387/health

# LLM service health
curl http://localhost:8001/health

# Dual-engine status
curl http://localhost:4387/api/dual-engine/health
```

### Metrics

Check `backend/metrics/` for:
- Agreement score distribution
- Conflict rate trends
- Processing time percentiles
- LLM vs OCR accuracy comparison

### Logs

```bash
# Real-time logs
docker-compose logs -f api llm

# Search for conflicts
docker-compose logs api | grep "dual_engine_merge"

# Check routing decisions
docker-compose logs api | grep "dual_engine_routing"
```

## Troubleshooting

### LLM Service Won't Start

**Symptom**: `llm` container exits immediately

**Fixes**:
1. Check GPU access: `nvidia-smi`
2. Verify CUDA version: `nvidia-smi | grep "CUDA Version"`
3. Check disk space for model download: `df -h`
4. Review logs: `docker-compose logs llm`

### Low Agreement Scores

**Symptom**: Agreement consistently <70%

**Fixes**:
1. Check OCR quality: Review `result.ocr` pages
2. Adjust fuzzy match threshold in `dualEngine.js`
3. Try different LLM model (Qwen2-VL recommended for medical)
4. Add field-specific rules for problematic fields

### High Conflict Rate

**Symptom**: Many conflicts flagged for manual review

**Fixes**:
1. Lower fuzzy match threshold (85% → 80%)
2. Add more field-specific rules
3. Improve OCR preprocessing (contrast, rotation)
4. Fine-tune LLM prompt in `llm_service/main.py`

### Slow Processing

**Symptom**: Processing takes >30 seconds

**Fixes**:
1. Check GPU utilization: `nvidia-smi`
2. Reduce LLM max_new_tokens (2048 → 1024)
3. Use smaller model (Phi-3.5 → MiniCPM-V)
4. Optimize parallel processing in `dualEngineProcessor.js`

## Future Enhancements

### Phase 2: Learning System
- [ ] Store resolution decisions in database
- [ ] Train custom conflict resolver
- [ ] Auto-tune fuzzy match thresholds per field
- [ ] Build provider-specific correction rules

### Phase 3: Advanced Features
- [ ] Multi-page document handling (extract key pages first)
- [ ] Batch processing mode (queue multiple documents)
- [ ] Real-time feedback loop (user corrections → model improvement)
- [ ] Confidence-based selective LLM usage (only low OCR confidence)

### Phase 4: Integration
- [ ] EHR system integration (HL7/FHIR export)
- [ ] Insurance eligibility verification API
- [ ] Provider directory lookup (NPI validation)
- [ ] Automated scheduling system integration

## Development

### Running Tests

```bash
# Backend tests
cd backend
npm test

# LLM service tests
cd llm_service
pytest tests/

# Frontend tests
cd frontend
npm test
```

### Adding a New Validation Level

1. Edit `backend/decisionTree.js`
2. Add new check method (e.g., `checkCompliance`)
3. Update `evaluate()` to include new level
4. Update frontend `DecisionTreeVisualization.jsx` icon map
5. Add tests for new validation

### Contributing

1. Create feature branch from `paddleocr_AI`
2. Implement changes with tests
3. Update documentation
4. Submit PR with description and screenshots

## Credits

- **PaddleOCR**: Baidu PaddlePaddle team
- **Phi-3.5 Vision**: Microsoft Research
- **Architecture Design**: Copilot + User collaboration
- **Medical Domain Expertise**: Client team

## License

Proprietary - Internal use only

---

**Questions?** Contact the development team or check the main project README.
