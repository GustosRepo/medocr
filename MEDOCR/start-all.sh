#!/bin/zsh

# Start backend
echo "Starting backend..."
cd MEDOCR/backend
# Adjust the command below to your backend start command (e.g., python app.py, flask run, uvicorn main:app, etc.)
# Example for Flask:
# flask run --port=5001
# Example for FastAPI:
# uvicorn main:app --reload --port 5001
# Example for generic Python:
# python app.py
# Replace the line below with your actual backend start command:
python app.py &

# Start frontend
echo "Starting frontend..."
cd ../frontend
npm run dev &

# Return to root
cd ../..

echo "Both backend and frontend started."