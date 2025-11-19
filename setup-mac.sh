#!/bin/bash
# Mac M-Series Setup Script for Dual-Engine MedOCR
# Supports Apple Silicon (M1/M2/M3/M4) with MPS (Metal Performance Shaders)

set -e  # Exit on error

echo "🍎 Setting up Dual-Engine MedOCR for Mac (Apple Silicon)"
echo "=========================================================="

# Check if running on Mac
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This script is for macOS only"
    exit 1
fi

# Check for Apple Silicon
ARCH=$(uname -m)
if [[ "$ARCH" != "arm64" ]]; then
    echo "⚠️  Warning: Not running on Apple Silicon (detected: $ARCH)"
    echo "   MPS acceleration requires M1/M2/M3/M4 chip"
fi

echo ""
echo "📋 Prerequisites:"
echo "  - Python 3.10+"
echo "  - Node.js 18+"
echo "  - ~10GB disk space for model"
echo ""

# Check Python version
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version | awk '{print $2}')
    echo "✅ Python: $PYTHON_VERSION"
else
    echo "❌ Python 3 not found. Install from https://python.org"
    exit 1
fi

# Check Node.js version
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js: $NODE_VERSION"
else
    echo "❌ Node.js not found. Install from https://nodejs.org"
    exit 1
fi

echo ""
echo "🔧 Installation Steps:"
echo ""

# Step 1: Backend dependencies
echo "1️⃣  Installing backend dependencies..."
cd backend
npm install
cd ..
echo "✅ Backend dependencies installed"

# Step 2: Frontend dependencies
echo ""
echo "2️⃣  Installing frontend dependencies..."
cd frontend
npm install
cd ..
echo "✅ Frontend dependencies installed"

# Step 3: LLM service dependencies
echo ""
echo "3️⃣  Installing LLM service dependencies (this may take a few minutes)..."
cd llm_service

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "   Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install PyTorch with MPS support
echo "   Installing PyTorch with Apple Silicon (MPS) support..."
pip install torch torchvision torchaudio

# Install other requirements
echo "   Installing other dependencies..."
pip install -r requirements.txt

cd ..
echo "✅ LLM service dependencies installed"

# Step 4: Create .env file
echo ""
echo "4️⃣  Creating .env configuration..."
if [ ! -f ".env" ]; then
    cat > .env << EOF
# Backend Configuration
NODE_ENV=development
PORT=4387

# OCR Service
OCR_SERVICE_URL=http://127.0.0.1:8000
OCR_TIMEOUT_MS=60000

# LLM Service (Mac - runs on localhost, not Docker)
ENABLE_LLM=true
LLM_SERVICE_URL=http://127.0.0.1:8001
LLM_TIMEOUT=30000

# Model Configuration
MODEL_NAME=microsoft/phi-3.5-vision-instruct
DEVICE=mps
TRANSFORMERS_CACHE=./llm_service/models

# Processing
MAX_PDF_PAGES=150
UPLOAD_MAX_BYTES=52428800
EOF
    echo "✅ .env file created"
else
    echo "⚠️  .env file already exists, skipping"
fi

# Step 5: Download model (optional)
echo ""
echo "5️⃣  Model download:"
echo "   The Phi-3.5 Vision model (~5GB) will download on first use."
echo "   You can pre-download it now or skip and download on first run."
echo ""
read -p "   Download model now? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd llm_service
    source venv/bin/activate
    python3 << 'PYEOF'
print("Downloading model...")
from transformers import AutoModelForVision2Seq, AutoProcessor
model_name = "microsoft/phi-3.5-vision-instruct"
print(f"Loading {model_name}...")
processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
model = AutoModelForVision2Seq.from_pretrained(
    model_name,
    trust_remote_code=True,
    low_cpu_mem_usage=True
)
print("✅ Model downloaded successfully!")
PYEOF
    cd ..
fi

echo ""
echo "🎉 Setup Complete!"
echo ""
echo "📝 Next Steps:"
echo ""
echo "1. Start OCR service (if not already running):"
echo "   cd ocr_service && docker-compose up -d"
echo ""
echo "2. Start LLM service:"
echo "   cd llm_service"
echo "   source venv/bin/activate"
echo "   python main.py"
echo ""
echo "3. Start backend (in new terminal):"
echo "   cd backend"
echo "   npm start"
echo ""
echo "4. Start frontend (in new terminal):"
echo "   cd frontend"
echo "   npm run dev"
echo ""
echo "5. Open browser:"
echo "   http://localhost:5173"
echo ""
echo "⚡ The LLM will use Apple Metal (MPS) for GPU acceleration!"
echo ""
