#!/usr/bin/env python3
"""Quick debug runner for OCR preprocessing and engine outputs"""
import os
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
import pytesseract

try:
    from paddleocr import PaddleOCR
    PADDLE_AVAILABLE = True
except Exception:
    PADDLE_AVAILABLE = False


def deskew_image(image: np.ndarray):
    thresh = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if coords.size == 0:
        return image
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) < 0.5:
        return image
    (h, w) = image.shape[:2]
    M = cv2.getRotationMatrix2D((w//2, h//2), angle, 1.0)
    return cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def preprocess(image_path: str):
    img = Image.open(image_path)
    arr = np.array(img)
    if len(arr.shape) == 3:
        gray = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY)
    else:
        gray = arr.copy()
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    gray = clahe.apply(gray)
    gray = cv2.fastNlMeansDenoising(gray, h=10)
    gray = deskew_image(gray)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2,2))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    h, w = binary.shape
    binary = cv2.resize(binary, (w*2, h*2), interpolation=cv2.INTER_CUBIC)
    gaussian = cv2.GaussianBlur(binary, (0,0), 2.0)
    sharp = cv2.addWeighted(binary, 2.0, gaussian, -1.0, 0)
    return sharp


def run_debug(path: str):
    debug_out = Path('ocr_debug_workspace')
    debug_out.mkdir(exist_ok=True)
    pre = preprocess(path)
    pre_path = debug_out / 'preprocessed.png'
    cv2.imwrite(str(pre_path), pre)
    print(f'Preprocessed image saved: {pre_path.resolve()}')

    # Tesseract
    try:
        pil = Image.fromarray(pre)
        data = pytesseract.image_to_data(pil, output_type=pytesseract.Output.DICT)
        text = pytesseract.image_to_string(pil)
        confs = [float(c) for c in data.get('conf', []) if str(c).lstrip('-').replace('.','',1).isdigit()]
        avg_conf = round(sum(confs)/len(confs),2) if confs else -1
        print('\n[TESSERACT] avg_conf:', avg_conf)
        print('\n[TESSERACT] text:\n', text)
    except Exception as e:
        print('Tesseract failed:', e)

    # Paddle
    if PADDLE_AVAILABLE:
        try:
            ocr = PaddleOCR(use_angle_cls=True, lang='en')
            res = ocr.ocr(pre, cls=True)
            lines = []
            confs = []
            if res and res[0]:
                for line in res[0]:
                    lines.append(line[1][0])
                    confs.append(line[1][1]*100)
            print('\n[PADDLE] avg_conf:', round(sum(confs)/len(confs),2) if confs else -1)
            print('\n[PADDLE] text:\n', '\n'.join(lines))
        except Exception as e:
            print('Paddle failed:', e)
    else:
        print('\nPaddleOCR not installed in environment')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: debug_runner.py <image_path>')
        sys.exit(1)
    run_debug(sys.argv[1])
