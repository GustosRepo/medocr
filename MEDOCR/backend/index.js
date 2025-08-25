import express from "express";
import cors from "cors";
import multer from "multer";
import { spawn } from "child_process";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

app.get("/health", (_req, res) => res.json({ ok: true }));


app.post("/ocr", upload.array("file"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  const pythonCmd = process.env.PYTHON || "python3";
  const workerPath = path.join(process.cwd(), "..", "ocr-worker", "main.py");
  const fillTemplatePath = path.join(process.cwd(), "..", "ocr-worker", "fill_template.py");
  const templatePath = path.join(process.cwd(), "..", "ocr-worker", "template.txt");

  // Process all files in parallel
  const results = await Promise.all(req.files.map((file, idx) => {
    return new Promise((resolve) => {
      const imgPath = path.resolve(file.path);
      const ocrOutPath = path.resolve(`uploads/ocr_result_${Date.now()}_${idx}.txt`);
      const py = spawn(pythonCmd, [workerPath, imgPath]);
      let out = "";
      let err = "";
      py.stdout.on("data", (d) => (out += d.toString()));
      py.stderr.on("data", (d) => (err += d.toString()));
      py.on("close", (code) => {
        fs.unlink(imgPath, () => {});
        if (code !== 0) {
          resolve({ filename: file.originalname, error: "OCR failed", details: err.trim() });
        } else {
          // Parse OCR JSON output to extract just the text
          let ocrResult;
          try {
            ocrResult = JSON.parse(out);
          } catch {
            ocrResult = { text: out, avg_conf: -1 };
          }
          
          // Save just the text content to temp file for template filling
          fs.writeFileSync(ocrOutPath, ocrResult.text);
          // Fill template
          const pyFill = spawn(pythonCmd, [fillTemplatePath, ocrOutPath, ocrOutPath + '.filled']);
          let fillOut = "";
          let fillErr = "";
          pyFill.stdout.on("data", (d) => (fillOut += d.toString()));
          pyFill.stderr.on("data", (d) => (fillErr += d.toString()));
          pyFill.on("close", (fillCode) => {
            let filledText = "";
            try {
              filledText = fs.readFileSync(ocrOutPath + '.filled', 'utf8');
            } catch {
              filledText = '';
            }
            // Cleanup temp files
            fs.unlink(ocrOutPath, () => {});
            fs.unlink(ocrOutPath + '.filled', () => {});
            resolve({ 
              filename: file.originalname, 
              text: ocrResult.text, 
              avg_conf: ocrResult.avg_conf,
              filled_template: filledText 
            });
          });
        }
      });
    });
  }));

  res.json({ results });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Backend running on http://localhost:${port}`));
