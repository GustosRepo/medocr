#!/bin/bash

# Replace all fetch calls with apiCall in App.jsx

cd /Users/devspace/Desktop/medocr/MEDOCR/frontend/src

# Replace feedback endpoint
sed -i '' 's/await fetch('\''http:\/\/localhost:5001\/feedback'\''/await apiCall('\''\/feedback'\''/g' App.jsx

# Replace checklist endpoints
sed -i '' 's/await fetch('\''http:\/\/localhost:5001\/checklist\/list'\''/await apiCall('\''\/checklist\/list'\''/g' App.jsx
sed -i '' 's/await fetch('\''http:\/\/localhost:5001\/checklist\/update'\''/await apiCall('\''\/checklist\/update'\''/g' App.jsx
sed -i '' 's/await fetch('\''http:\/\/localhost:5001\/checklist\/import-scan'\''/await apiCall('\''\/checklist\/import-scan'\''/g' App.jsx

# Replace rules endpoints
sed -i '' 's/await fetch('\''http:\/\/localhost:5001\/rules\/list-fields'\''/await apiCall('\''\/rules\/list-fields'\''/g' App.jsx
sed -i '' 's/await fetch('\''http:\/\/localhost:5001\/rules\/add'\''/await apiCall('\''\/rules\/add'\''/g' App.jsx

# Replace reextract endpoint
sed -i '' 's/await fetch('\''http:\/\/localhost:5001\/reextract-text'\''/await apiCall('\''\/reextract-text'\''/g' App.jsx

# Replace export endpoint
sed -i '' 's/await fetch('\''http:\/\/localhost:5001\/export-combined-pdf'\''/await apiCall('\''\/export-combined-pdf'\''/g' App.jsx

echo "✅ All fetch calls replaced with apiCall"
