// Express backend for MEDOCR
// POST /ocr accepts file upload, calls Python OCR worker, returns extracted text as JSON

const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

app.post('/ocr', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = path.resolve(req.file.path);
  const py = spawn('python3', [path.join(__dirname, '../ocr-worker/main.py'), filePath]);
  let ocrResult = '';
  py.stdout.on('data', data => { ocrResult += data.toString(); });
  py.stderr.on('data', data => { console.error('OCR Error:', data.toString()); });
  py.on('close', code => {
    fs.unlinkSync(filePath); // Clean up uploaded file
    if (code === 0) {
      res.json({ text: ocrResult.trim() });
    } else {
      res.status(500).json({ error: 'OCR failed' });
    }
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`MEDOCR backend running on http://localhost:${PORT}`);
});
