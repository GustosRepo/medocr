#!/usr/bin/env python3
"""
Phi-3.5 Vision LLM Service for Medical Document Extraction

This service provides vision-language model inference for validating
and enhancing OCR extraction from medical documents.
"""

import os
import json
import io
import time
from typing import Optional, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image
import torch
from transformers import AutoModelForVision2Seq, AutoProcessor
import uvicorn

# Configuration
MODEL_NAME = os.getenv("MODEL_NAME", "microsoft/phi-3.5-vision-instruct")
DEVICE = os.getenv("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
MAX_NEW_TOKENS = int(os.getenv("MAX_NEW_TOKENS", "2048"))
TEMPERATURE = float(os.getenv("TEMPERATURE", "0.0"))

# Initialize FastAPI
app = FastAPI(
    title="MedOCR LLM Service",
    description="Vision-Language Model for Medical Document Extraction",
    version="1.0.0"
)

# Global model and processor
model = None
processor = None

# Medical extraction prompt template
MEDICAL_EXTRACTION_PROMPT = """Extract the following information from this medical referral form. Be precise and only extract what you can clearly see.

Patient Information:
- Full name (Last, First Middle)
- Date of birth (MM/DD/YYYY format)
- Phone number (10 digits)

Insurance:
- Insurance carrier name
- Member/Policy ID
- Group number (if visible)

Provider:
- Ordering provider name (with credentials like MD, DO, NP)
- NPI number (if present)
- Provider phone or fax number

Clinical:
- Primary diagnosis or reason for referral
- ICD-10 code (if present)
- Requested procedure/test
- CPT code (if present)

Return ONLY valid JSON with this exact structure (use null for fields not found):
{
  "patient": {
    "name": "Last, First Middle" or null,
    "dob": "MM/DD/YYYY" or null,
    "phone": "(XXX) XXX-XXXX" or null
  },
  "insurance": {
    "carrier": "Carrier Name" or null,
    "memberId": "ID" or null,
    "groupId": "Group" or null
  },
  "provider": {
    "name": "Provider Name, Credentials" or null,
    "npi": "NPI" or null,
    "phone": "(XXX) XXX-XXXX" or null,
    "fax": "(XXX) XXX-XXXX" or null
  },
  "clinical": {
    "diagnosis": "Diagnosis text" or null,
    "icd10": "ICD code" or null,
    "procedure": "Procedure name" or null,
    "cpt": "CPT code" or null
  },
  "confidence": 0.0 to 1.0,
  "notes": "Any concerns or unclear fields"
}

Important:
- Return ONLY the JSON, no other text
- Use null (not empty string) for missing fields
- Format phone numbers as (XXX) XXX-XXXX
- Format dates as MM/DD/YYYY
- Preserve exact spelling and capitalization from document
- If text is illegible or ambiguous, use null and note it in "notes"
"""


def load_model():
    """Load the vision-language model on startup"""
    global model, processor
    
    print(f"[LLM] Loading model: {MODEL_NAME}")
    print(f"[LLM] Device: {DEVICE}")
    print(f"[LLM] PyTorch version: {torch.__version__}")
    print(f"[LLM] CUDA available: {torch.cuda.is_available()}")
    
    if torch.cuda.is_available():
        print(f"[LLM] CUDA device: {torch.cuda.get_device_name(0)}")
        print(f"[LLM] CUDA memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    
    try:
        # Load processor
        processor = AutoProcessor.from_pretrained(
            MODEL_NAME,
            trust_remote_code=True,
            cache_dir=os.getenv("TRANSFORMERS_CACHE", "/app/models")
        )
        print("[LLM] Processor loaded successfully")
        
        # Load model
        model = AutoModelForVision2Seq.from_pretrained(
            MODEL_NAME,
            torch_dtype=torch.float16 if DEVICE == "cuda" else torch.float32,
            device_map="auto",
            trust_remote_code=True,
            cache_dir=os.getenv("TRANSFORMERS_CACHE", "/app/models")
        )
        print(f"[LLM] Model loaded successfully on {DEVICE}")
        
        # Warm-up inference
        print("[LLM] Running warm-up inference...")
        dummy_image = Image.new('RGB', (224, 224), color='white')
        dummy_prompt = "Describe this image briefly."
        _run_inference(dummy_image, dummy_prompt)
        print("[LLM] Model ready for inference")
        
    except Exception as e:
        print(f"[LLM] Error loading model: {e}")
        raise


def _run_inference(image: Image.Image, prompt: str) -> str:
    """Run model inference on image with prompt"""
    global model, processor
    
    if model is None or processor is None:
        raise RuntimeError("Model not loaded")
    
    # Prepare messages in chat format
    messages = [
        {"role": "user", "content": f"<|image_1|>\n{prompt}"}
    ]
    
    # Apply chat template
    text = processor.apply_chat_template(
        messages,
        add_generation_prompt=True
    )
    
    # Prepare inputs
    inputs = processor(
        text=text,
        images=image,
        return_tensors="pt"
    )
    
    # Move to device
    if DEVICE == "cuda":
        inputs = {k: v.to(DEVICE) for k, v in inputs.items()}
    
    # Generate
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=MAX_NEW_TOKENS,
            do_sample=False if TEMPERATURE == 0.0 else True,
            temperature=TEMPERATURE if TEMPERATURE > 0 else None,
            pad_token_id=processor.tokenizer.pad_token_id,
            eos_token_id=processor.tokenizer.eos_token_id
        )
    
    # Decode response
    response = processor.decode(
        outputs[0],
        skip_special_tokens=True,
        clean_up_tokenization_spaces=True
    )
    
    return response


@app.on_event("startup")
async def startup_event():
    """Load model on service startup"""
    load_model()


@app.get("/")
def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": DEVICE,
        "gpu_available": torch.cuda.is_available(),
        "model_loaded": model is not None
    }


@app.post("/extract")
async def extract_from_image(
    image: UploadFile = File(...),
    prompt: Optional[str] = Form(None)
):
    """
    Extract structured data from medical document image
    
    Args:
        image: Uploaded image file (PNG, JPG, PDF)
        prompt: Optional custom prompt (uses medical template by default)
    
    Returns:
        JSON with extracted fields and metadata
    """
    start_time = time.time()
    
    try:
        # Read and validate image
        image_bytes = await image.read()
        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        print(f"[LLM] Processing image: {image.filename} ({pil_image.size})")
        
        # Use provided prompt or default medical extraction prompt
        extraction_prompt = prompt if prompt else MEDICAL_EXTRACTION_PROMPT
        
        # Run inference
        inference_start = time.time()
        response_text = _run_inference(pil_image, extraction_prompt)
        inference_time = time.time() - inference_start
        
        print(f"[LLM] Inference completed in {inference_time:.2f}s")
        
        # Extract JSON from response
        extracted_data = _parse_json_response(response_text)
        
        # Calculate total processing time
        total_time = time.time() - start_time
        
        return {
            "success": True,
            "data": extracted_data,
            "metadata": {
                "model": MODEL_NAME,
                "device": DEVICE,
                "inference_time": round(inference_time, 2),
                "total_time": round(total_time, 2),
                "image_size": pil_image.size
            }
        }
        
    except Exception as e:
        print(f"[LLM] Extraction failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Extraction failed: {str(e)}"
        )


@app.post("/validate")
async def validate_extraction(
    image: UploadFile = File(...),
    ocr_data: str = Form(...)
):
    """
    Validate OCR extraction by comparing with LLM vision analysis
    
    Args:
        image: Document image
        ocr_data: JSON string of OCR extracted data
    
    Returns:
        Validation results with conflicts and agreements
    """
    try:
        # Parse OCR data
        ocr_json = json.loads(ocr_data)
        
        # Extract with LLM
        llm_result = await extract_from_image(image, None)
        llm_data = llm_result["data"]
        
        # Compare and identify conflicts
        conflicts = _compare_extractions(ocr_json, llm_data)
        
        return {
            "success": True,
            "ocr_data": ocr_json,
            "llm_data": llm_data,
            "conflicts": conflicts,
            "agreement_score": 1.0 - (len(conflicts) / max(len(ocr_json), 1))
        }
        
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid OCR data JSON: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Validation failed: {str(e)}"
        )


def _parse_json_response(response: str) -> Dict[str, Any]:
    """
    Extract and parse JSON from model response
    
    The model may include extra text, so we need to find the JSON block
    """
    try:
        # Try to find JSON block in response
        json_start = response.find('{')
        json_end = response.rfind('}') + 1
        
        if json_start == -1 or json_end == 0:
            # No JSON found, return error structure
            return {
                "error": "No JSON found in response",
                "raw_response": response,
                "confidence": 0.0
            }
        
        json_str = response[json_start:json_end]
        parsed = json.loads(json_str)
        
        # Ensure confidence field exists
        if "confidence" not in parsed:
            parsed["confidence"] = 0.8
        
        return parsed
        
    except json.JSONDecodeError as e:
        print(f"[LLM] JSON parse error: {e}")
        print(f"[LLM] Response: {response}")
        return {
            "error": f"Failed to parse JSON: {str(e)}",
            "raw_response": response,
            "confidence": 0.0
        }


def _compare_extractions(ocr_data: Dict, llm_data: Dict) -> list:
    """Compare OCR and LLM extractions to find conflicts"""
    conflicts = []
    
    def compare_nested(path, ocr_val, llm_val):
        # Normalize values
        ocr_norm = str(ocr_val).strip() if ocr_val else None
        llm_norm = str(llm_val).strip() if llm_val else None
        
        # Skip if both empty
        if not ocr_norm and not llm_norm:
            return
        
        # Check for mismatch
        if ocr_norm != llm_norm:
            conflicts.append({
                "field": path,
                "ocr_value": ocr_val,
                "llm_value": llm_val
            })
    
    # Compare each field
    for section in ["patient", "insurance", "provider", "clinical"]:
        if section in ocr_data and section in llm_data:
            for key in ocr_data[section].keys():
                compare_nested(
                    f"{section}.{key}",
                    ocr_data[section].get(key),
                    llm_data[section].get(key)
                )
    
    return conflicts


if __name__ == "__main__":
    # Run the service
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8001,
        log_level="info"
    )
