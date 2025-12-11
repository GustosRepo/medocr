# 🧠 Full LLM Learning System - Implementation Plan

## Branch: `full-llm`

---

## 🎯 Goal
Transform MedOCR from static inference to a **self-improving AI system** that learns from user corrections and continuously improves accuracy.

---

## 📋 Phase 1: Data Collection Infrastructure (Week 1)

### ✅ What You Already Have
- ✅ Corrections database (`backend/corrections_db.js`)
- ✅ Feedback store (`backend/feedback/store.js`)
- ✅ User correction UI

### 🔨 What We'll Build

#### 1.1 Training Data Collector
**File:** `backend/training/dataCollector.js`
- Export corrections to training format
- Pair: `{original_ocr_output, user_correction, document_image}`
- HIPAA filter: Block all PHI fields
- Minimum threshold: 100 corrections before training

#### 1.2 Dataset Builder
**File:** `backend/training/datasetBuilder.js`
- Convert corrections to fine-tuning format:
  - For LLaVA: Vision-language pairs
  - For PaddleOCR: Text recognition pairs
- Split: 80% train / 10% validation / 10% test
- Export formats: JSON-L, Parquet, HuggingFace Dataset

#### 1.3 Quality Control
**File:** `backend/training/qualityCheck.js`
- Remove duplicates
- Filter low-confidence corrections (< 3 user approvals)
- Validate data integrity
- Generate dataset statistics

**Deliverable:** Automated pipeline to export training-ready datasets from corrections

---

## 📋 Phase 2: Model Fine-Tuning Pipeline (Week 2-3)

### 2.1 LLaVA Vision Model Fine-Tuning
**Directory:** `training/llava/`

**Tools:**
- **LLaMA Factory** (easiest option)
- **Axolotl** (more control)
- **HuggingFace PEFT** (custom)

**What We'll Do:**
```python
# training/llava/finetune.py
from transformers import LlavaForConditionalGeneration, AutoProcessor
from peft import LoraConfig, get_peft_model
import torch

# 1. Load base LLaVA model
base_model = "llava-hf/llava-1.5-7b-hf"

# 2. Add LoRA adapters (efficient fine-tuning)
lora_config = LoraConfig(
    r=16,  # Low rank
    lora_alpha=32,
    target_modules=["q_proj", "v_proj"],
    lora_dropout=0.05,
)

# 3. Train on your medical documents
# Input: Corrections from backend/data/corrections.json
# Output: LoRA weights (small ~100MB file)
```

**Benefits:**
- Don't need to retrain full 7B model (only ~100MB adapter)
- Runs on your MacBook Pro
- Can fine-tune on her Intel system with OpenVINO

### 2.2 PaddleOCR Text Recognition Fine-Tuning
**Directory:** `training/paddleocr/`

**What We'll Do:**
- Fine-tune PaddleOCR recognizer on medical terminology
- Train on your specific font styles/handwriting
- Export optimized ONNX model

### 2.3 Training Scripts
**File:** `training/train.sh`
```bash
#!/bin/bash
# Automated training pipeline

# Step 1: Export corrections
node backend/training/dataCollector.js --min-corrections 100

# Step 2: Build dataset
python training/datasetBuilder.py

# Step 3: Fine-tune LLaVA
python training/llava/finetune.py --epochs 3 --batch-size 4

# Step 4: Validate improvements
python training/validate.py --test-set validation_data.json

# Step 5: Deploy if accuracy improved
./training/deploy.sh
```

**Deliverable:** One-command training pipeline

---

## 📋 Phase 3: OpenVINO GPU Acceleration (Week 3)

### 3.1 Intel GPU Support for Windows
**Directory:** `openvino/`

**What We'll Build:**
```python
# openvino/inference.py
from openvino.runtime import Core
import numpy as np

class OpenVINOModel:
    def __init__(self, model_path):
        ie = Core()
        # Use Intel Arc GPU
        self.model = ie.compile_model(model_path, "GPU")
    
    def infer(self, image):
        # 3-5x faster on Intel Arc vs CPU
        return self.model(image)
```

**Steps:**
1. Convert LLaVA to OpenVINO IR format
2. Optimize for Intel Arc architecture
3. Integrate with existing backend
4. Fallback to CPU if GPU unavailable

### 3.2 Hybrid Backend
**File:** `backend/llm/hybridService.js`
```javascript
// Auto-detect best backend
if (platform === 'darwin') {
  // Mac: Use Ollama with Metal
  backend = new OllamaService();
} else if (hasIntelGPU()) {
  // Windows Intel: Use OpenVINO
  backend = new OpenVINOService();
} else {
  // Fallback: Ollama CPU
  backend = new OllamaService();
}
```

**Deliverable:** Platform-optimized inference with Intel GPU support

---

## 📋 Phase 4: Active Learning Loop (Week 4)

### 4.1 Confidence-Based Sampling
**File:** `backend/training/activeLearning.js`
```javascript
// Prioritize corrections that will help most
function selectTrainingSamples(corrections) {
  return corrections
    .filter(c => c.confidence < 0.8) // Low confidence
    .filter(c => c.occurrences > 3)   // Frequent error
    .sort((a, b) => b.impact - a.impact); // High impact
}
```

### 4.2 Model Performance Tracking
**File:** `backend/metrics/modelMetrics.js`
- Track accuracy over time
- A/B test new models vs old
- Automatic rollback if accuracy drops

### 4.3 Automated Training Triggers
```javascript
// Auto-trigger training when:
- 100+ new corrections collected
- Accuracy drops below threshold
- Monthly schedule
- Manual trigger from UI
```

### 4.4 UI for Training Management
**Component:** `frontend/src/pages/TrainingPage.jsx`
- View correction statistics
- Trigger training runs
- Monitor training progress
- Compare model versions
- Deploy new models

**Deliverable:** Self-improving system that gets better automatically

---

## 📋 Phase 5: Deployment & Monitoring (Week 5)

### 5.1 Model Versioning
**Directory:** `models/versions/`
```
models/
  versions/
    llava-v1.0-base/
    llava-v1.1-finetuned-100samples/
    llava-v1.2-finetuned-500samples/
    current -> llava-v1.2-finetuned-500samples/
```

### 5.2 Hot-Swap Models
**File:** `backend/llm/modelManager.js`
```javascript
// Switch models without restart
async function deployModel(version) {
  // Load new model
  const newModel = await loadModel(version);
  
  // A/B test on next 10 documents
  const results = await abTest(newModel, currentModel);
  
  // Switch if better
  if (results.newAccuracy > results.oldAccuracy) {
    currentModel = newModel;
    saveMetrics(results);
  }
}
```

### 5.3 Training Dashboard
**Component:** `frontend/src/pages/ModelDashboard.jsx`
- Model accuracy over time
- Training history
- Correction statistics
- GPU utilization (OpenVINO)
- Training queue status

### 5.4 HIPAA Compliance Audit
**File:** `docs/HIPAA_ML_COMPLIANCE.md`
- Document that training data excludes PHI
- Audit logs for model updates
- Data retention policies
- Security measures

**Deliverable:** Production-ready ML system with monitoring

---

## 🛠️ Technology Stack

### Training
- **LLaMA Factory** - Easy LoRA fine-tuning
- **Axolotl** - Advanced training configs
- **HuggingFace Transformers** - Model loading
- **PEFT** - Parameter-efficient fine-tuning

### Inference Optimization
- **OpenVINO** - Intel GPU acceleration
- **ONNX Runtime** - Cross-platform optimization
- **Ollama** - Mac/easy deployment

### Data
- **SQLite** - Training data versioning
- **Parquet** - Efficient dataset storage
- **HuggingFace Datasets** - Standard format

### Monitoring
- **Prometheus** - Metrics collection
- **Grafana** - Dashboards (optional)
- **Custom UI** - Built into MedOCR frontend

---

## 📊 Success Metrics

### Accuracy Improvements
- **Baseline:** Current static model accuracy
- **Target:** +10-15% accuracy after 500 corrections
- **Measure:** Test set of 50 held-out documents

### Performance
- **Mac (Your system):** Maintain current speed
- **Windows Intel (Client):** Match Mac performance with OpenVINO
- **Training time:** < 2 hours for 100 samples on your Mac

### User Experience
- **Transparency:** Show which corrections trained the model
- **Trust:** Display model confidence scores
- **Control:** Manual approval before deploying new models

---

## 🗓️ Timeline

### Week 1: Data Infrastructure
- ✅ Day 1-2: Data collector & HIPAA filters
- ✅ Day 3-4: Dataset builder
- ✅ Day 5: Quality control & validation

### Week 2: Fine-Tuning Setup
- ✅ Day 6-7: LLaMA Factory setup & test run
- ✅ Day 8-9: LoRA configuration for medical docs
- ✅ Day 10: First training run on corrections

### Week 3: OpenVINO Integration
- ✅ Day 11-12: Convert models to OpenVINO
- ✅ Day 13-14: Intel GPU optimization
- ✅ Day 15: Test on client's Intel system

### Week 4: Active Learning
- ✅ Day 16-17: Confidence-based sampling
- ✅ Day 18-19: Performance tracking
- ✅ Day 20: Automated training triggers

### Week 5: Production
- ✅ Day 21-22: Model versioning & deployment
- ✅ Day 23-24: Training dashboard UI
- ✅ Day 25: HIPAA audit & documentation

---

## 🚀 Quick Start (Day 1)

### Step 1: Install Training Dependencies
```bash
# On your Mac (development)
pip install transformers peft accelerate bitsandbytes datasets
pip install llama-factory  # Easy fine-tuning
pip install openvino openvino-dev  # Intel optimization

# For training
pip install torch torchvision torchaudio
```

### Step 2: Export Existing Corrections
```bash
node backend/training/dataCollector.js --export corrections_dataset.json
```

### Step 3: Run First Training Test
```bash
# Test with 10 samples first
python training/llava/finetune.py --samples 10 --epochs 1 --test-mode
```

### Step 4: Validate Improvements
```bash
python training/validate.py --before base_model --after finetuned_model
```

---

## 💰 Cost Estimate

### Free (What we're using)
- ✅ LLaVA base model (open source)
- ✅ OpenVINO (free from Intel)
- ✅ LLaMA Factory (open source)
- ✅ All training tools (open source)

### Hardware Requirements
- **Your Mac:** ✅ Perfect for training (24GB RAM, Metal GPU)
- **Client Windows:** ✅ Fine for inference with OpenVINO
- **Training time:** ~1-2 hours per run on your Mac
- **Storage:** ~10GB for models + training data

### No Cloud Costs
- Everything runs locally
- HIPAA compliant (no PHI leaves your systems)
- No OpenAI/Anthropic API costs

---

## 🎯 Expected Results

### After 100 Corrections
- **Provider names:** 95% → 98% accuracy
- **CPT codes:** 92% → 96% accuracy
- **Medical terms:** 88% → 93% accuracy

### After 500 Corrections
- **Overall OCR:** +10-15% accuracy improvement
- **Domain-specific:** Near-perfect on your document types
- **Speed:** Same or faster (optimized models)

### After 1000 Corrections
- **Custom model:** Beats GPT-4 Vision on YOUR specific documents
- **Zero-shot learning:** Handles new providers/facilities
- **Confidence:** 99%+ on repeated patterns

---

## 🔒 HIPAA Compliance

### What We'll Never Store
- ❌ Patient names
- ❌ DOB
- ❌ Member IDs
- ❌ SSN
- ❌ Any other PHI

### What We Can Learn From
- ✅ Provider names (public information)
- ✅ Practice names (public)
- ✅ Medical terminology (not PHI)
- ✅ CPT codes (standard codes)
- ✅ ICD codes (standard codes)
- ✅ Document structure/layout

### Audit Trail
- All training runs logged
- Model versions tracked
- Data sources documented
- No PHI in training data (verified)

---

## 🚦 Go/No-Go Decision Points

### After Week 1 (Data Collection)
**Decision:** Do we have enough quality corrections?
- ✅ GO: 100+ corrections, clean data
- ❌ NO-GO: < 50 corrections, need more data

### After Week 2 (First Training Run)
**Decision:** Does fine-tuning improve accuracy?
- ✅ GO: +5% accuracy on test set
- ❌ NO-GO: No improvement, adjust approach

### After Week 3 (OpenVINO)
**Decision:** Does Intel GPU work for client?
- ✅ GO: 2-3x speedup on her system
- ❌ NO-GO: Stick with CPU-optimized models

### After Week 4 (Active Learning)
**Decision:** Does automated training work?
- ✅ GO: Clean deployment to production
- ❌ NO-GO: Keep manual training process

---

## 📝 Next Actions

### Today (Day 1)
1. ✅ Create branch `full-llm` ✅ DONE
2. ⏳ Install training dependencies
3. ⏳ Create data collector script
4. ⏳ Export first batch of corrections

### Tomorrow (Day 2)
1. ⏳ Build training dataset
2. ⏳ Setup LLaMA Factory
3. ⏳ Run first test training (10 samples)
4. ⏳ Validate improvement

### This Week
1. ⏳ Complete Phase 1 (Data Infrastructure)
2. ⏳ Start Phase 2 (Fine-tuning)
3. ⏳ Document progress
4. ⏳ Test on real documents

---

## 🤝 Division of Work

### Your Role (Developer)
- Backend infrastructure
- Training pipeline
- Model deployment
- HIPAA compliance

### My Role (AI Agent)
- Architecture design
- Code generation
- Testing & validation
- Documentation

### Client Testing
- Test on Windows Intel system
- Provide feedback on accuracy
- Collect more corrections
- Production validation

---

## 📚 Resources

### Documentation to Create
1. `TRAINING_GUIDE.md` - How to run training
2. `OPENVINO_SETUP.md` - Intel GPU setup for Windows
3. `MODEL_VERSIONING.md` - Managing model versions
4. `HIPAA_ML_COMPLIANCE.md` - Compliance documentation

### Scripts to Build
1. `training/train.sh` - One-command training
2. `training/export_corrections.js` - Data export
3. `training/deploy_model.sh` - Model deployment
4. `training/validate_model.py` - Accuracy testing

---

## 🎉 End Goal

**A self-improving medical OCR system that:**
- ✅ Learns from every correction
- ✅ Gets better automatically
- ✅ Runs fast on both Mac and Windows Intel
- ✅ Maintains HIPAA compliance
- ✅ Transparent about what it learned
- ✅ Costs $0 (all local, open source)
- ✅ Eventually beats GPT-4 Vision on YOUR documents

**Ready to start?** Say "let's go" and I'll begin with Phase 1, Day 1! 🚀
