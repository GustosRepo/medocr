#!/bin/bash
# Ollama-based Setup for Mac M4
# Much simpler than Python-based approach!

set -e

echo "🦙 Setting up Dual-Engine MedOCR with Ollama"
echo "=============================================="

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama not found!"
    echo ""
    echo "Please install Ollama first:"
    echo "  1. Visit https://ollama.com/download"
    echo "  2. Download and install Ollama for Mac"
    echo "  3. Run this script again"
    exit 1
fi

echo "✅ Ollama installed: $(ollama --version)"

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo "⚠️  Ollama service not running"
    echo "   Starting Ollama..."
    ollama serve &
    sleep 3
fi

echo ""
echo "📋 Available Vision Models:"
echo ""
echo "  1. llava:13b      - Best quality, slower (~20-30s)"
echo "  2. llava:7b       - Good balance (~15-20s)"
echo "  3. llava-phi3     - Fastest, good quality (~10-15s)"
echo "  4. bakllava       - Optimized for documents"
echo ""
read -p "Which model to use? (1-4, default: 3): " MODEL_CHOICE

case ${MODEL_CHOICE:-3} in
    1) MODEL_NAME="llava:13b" ;;
    2) MODEL_NAME="llava:7b" ;;
    3) MODEL_NAME="llava-phi3" ;;
    4) MODEL_NAME="bakllava" ;;
    *) MODEL_NAME="llava-phi3" ;;
esac

echo ""
echo "📥 Pulling model: $MODEL_NAME"
echo "   (This may take 5-10 minutes on first run...)"
ollama pull $MODEL_NAME

echo ""
echo "✅ Model ready!"

# Install Node.js dependencies
echo ""
echo "📦 Installing dependencies..."

cd backend
npm install node-fetch form-data
cd ..

cd frontend
npm install
cd ..

# Create .env configuration
echo ""
echo "⚙️  Creating .env configuration..."

cat > .env << EOF
# Backend Configuration
NODE_ENV=development
PORT=4387

# OCR Service
OCR_SERVICE_URL=http://127.0.0.1:8000
OCR_TIMEOUT_MS=60000

# Ollama LLM Service
ENABLE_LLM=true
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=$MODEL_NAME
OLLAMA_TIMEOUT=60000

# Processing
MAX_PDF_PAGES=150
UPLOAD_MAX_BYTES=52428800
EOF

echo "✅ Configuration complete!"

echo ""
echo "🎉 Setup Complete!"
echo ""
echo "📝 To start the system:"
echo ""
echo "Terminal 1 - Backend:"
echo "  cd backend && npm start"
echo ""
echo "Terminal 2 - Frontend:"
echo "  cd frontend && npm run dev"
echo ""
echo "Terminal 3 - OCR Service (if not running):"
echo "  cd ocr_service && docker-compose up -d"
echo ""
echo "Ollama is already running in the background!"
echo ""
echo "🌐 Open browser: http://localhost:5173"
echo ""
echo "💡 Using model: $MODEL_NAME"
echo "   Processing time: ~10-30s per document"
echo "   Uses Mac M4 GPU automatically via Metal"
echo ""
