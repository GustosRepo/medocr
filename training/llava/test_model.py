"""
Test and compare base model vs fine-tuned model
"""

import json
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

# Paths
BASE_MODEL = "distilgpt2"  # Must match training script
FINETUNED_MODEL = "./training/models/finetuned"
TEST_DATA = "./training/datasets/training_data_latest.json"

def load_models():
    """Load both base and fine-tuned models"""
    print("🤖 Loading models...")
    
    # Base model
    print("   Loading base model...")
    base_tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    if base_tokenizer.pad_token is None:
        base_tokenizer.pad_token = base_tokenizer.eos_token
    
    base_model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True
    )
    
    # Fine-tuned model
    print("   Loading fine-tuned model...")
    finetuned_model = PeftModel.from_pretrained(base_model, FINETUNED_MODEL)
    finetuned_tokenizer = AutoTokenizer.from_pretrained(FINETUNED_MODEL)
    if finetuned_tokenizer.pad_token is None:
        finetuned_tokenizer.pad_token = finetuned_tokenizer.eos_token
    
    print("✅ Models loaded\n")
    return (base_model, base_tokenizer), (finetuned_model, finetuned_tokenizer)

def test_correction(model, tokenizer, ocr_text, field):
    """Test model on a single OCR correction"""
    prompt = f"OCR extracted: {ocr_text}\nField: {field}\nCorrect to:"
    
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=50,
            num_return_sequences=1,
            temperature=0.7,
            do_sample=True
        )
    
    generated = tokenizer.decode(outputs[0], skip_special_tokens=True)
    # Extract just the correction part
    correction = generated.replace(prompt, "").strip()
    
    return correction

def run_comparison():
    """Compare base vs fine-tuned on test data"""
    print("=" * 60)
    print("📊 Model Comparison Test")
    print("=" * 60)
    print()
    
    # Load models
    (base_model, base_tokenizer), (finetuned_model, finetuned_tokenizer) = load_models()
    
    # Load test data
    with open(TEST_DATA, 'r') as f:
        test_data = json.load(f)
    
    # Test on first 5 samples
    print(f"Testing on {min(5, len(test_data))} samples...\n")
    
    results = []
    for i, item in enumerate(test_data[:5]):
        print(f"Test {i+1}:")
        print(f"  OCR: {item['ocrText']}")
        print(f"  Field: {item['field']}")
        print(f"  Expected: {item['correctedText']}")
        
        # Base model prediction
        base_pred = test_correction(base_model, base_tokenizer, item['ocrText'], item['field'])
        print(f"  Base model: {base_pred}")
        
        # Fine-tuned model prediction
        ft_pred = test_correction(finetuned_model, finetuned_tokenizer, item['ocrText'], item['field'])
        print(f"  Fine-tuned: {ft_pred}")
        
        # Check accuracy
        base_correct = base_pred.strip().lower() == item['correctedText'].strip().lower()
        ft_correct = ft_pred.strip().lower() == item['correctedText'].strip().lower()
        
        print(f"  Base correct: {'✅' if base_correct else '❌'}")
        print(f"  Fine-tuned correct: {'✅' if ft_correct else '❌'}")
        print()
        
        results.append({
            'ocr': item['ocrText'],
            'expected': item['correctedText'],
            'base': base_pred,
            'finetuned': ft_pred,
            'base_correct': base_correct,
            'ft_correct': ft_correct
        })
    
    # Summary
    base_accuracy = sum(r['base_correct'] for r in results) / len(results) * 100
    ft_accuracy = sum(r['ft_correct'] for r in results) / len(results) * 100
    
    print("=" * 60)
    print("📊 Results Summary")
    print("=" * 60)
    print(f"Base model accuracy: {base_accuracy:.1f}%")
    print(f"Fine-tuned accuracy: {ft_accuracy:.1f}%")
    print(f"Improvement: {ft_accuracy - base_accuracy:+.1f}%")
    print("=" * 60)

if __name__ == "__main__":
    run_comparison()
