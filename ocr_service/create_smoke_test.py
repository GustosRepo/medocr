#!/usr/bin/env python3
"""
Smoke test for benchmark.py
Creates a synthetic test image with known text to verify OCR accuracy calculations.
"""

import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# Create test_data directory if needed
test_dir = Path(__file__).parent / 'test_data'
test_dir.mkdir(exist_ok=True)

# Create a simple test image with text
img = Image.new('RGB', (800, 400), color='white')
draw = ImageDraw.Draw(img)

# Use default font
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 24)
except:
    font = ImageFont.load_default()

# Draw test text
test_text = """Medical Referral Form

Patient Name: John Doe
Date of Birth: 01/15/1980
Phone: (555) 123-4567

Insurance: Blue Cross Blue Shield
Member ID: ABC123456789

Referring Provider: Dr. Jane Smith, MD
Provider Phone: (555) 987-6543

Procedure: Home Sleep Study
CPT Code: 95800
ICD-10: G47.33"""

y_offset = 20
for line in test_text.split('\n'):
    draw.text((20, y_offset), line, fill='black', font=font)
    y_offset += 30

# Save test image
test_image_path = test_dir / 'smoke_test.png'
img.save(test_image_path)
print(f"Created test image: {test_image_path}")

# Save ground truth
test_gt_path = test_dir / 'smoke_test.txt'
with open(test_gt_path, 'w', encoding='utf-8') as f:
    f.write(test_text)
print(f"Created ground truth: {test_gt_path}")

print("\nRun benchmark with:")
print(f"  cd ocr_service && python benchmark.py --single test_data/smoke_test.png --ground-truth test_data/smoke_test.txt")
