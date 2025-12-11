"""
Simple Fine-Tuning Script for Medical OCR Corrections
Uses PEFT (LoRA) for memory-efficient fine-tuning on small datasets

This script fine-tunes a text model on OCR corrections to improve future extractions.
"""

import json
import torch
from transformers import (
    AutoModelForCausalLM, 
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForLanguageModeling
)
from peft import LoraConfig, get_peft_model, TaskType
from datasets import Dataset
import os

# Configuration
MODEL_NAME = "distilgpt2"  # Small, ungated model (82M params)
# Alternative: "gpt2" (124M), "TinyLlama/TinyLlama-1.1B-Chat-v1.0" (gated)
OUTPUT_DIR = "./training/models/finetuned"
TRAINING_DATA = "./training/datasets/training_data_latest.json"

# LoRA configuration - memory efficient
LORA_CONFIG = LoraConfig(
    r=8,  # Low rank - start small
    lora_alpha=16,
    target_modules=["c_attn"],  # GPT-2 attention layer
    lora_dropout=0.05,
    bias="none",
    task_type=TaskType.CAUSAL_LM
)

# Training configuration
TRAINING_CONFIG = {
    "num_train_epochs": 3,  # More epochs for small dataset
    "per_device_train_batch_size": 2,  # Small batch for 31 samples
    "gradient_accumulation_steps": 4,  # Simulate larger batch
    "learning_rate": 2e-4,
    "warmup_steps": 10,
    "logging_steps": 5,
    "save_strategy": "epoch",
    "output_dir": OUTPUT_DIR,
    "overwrite_output_dir": True,
    "fp16": True,  # Use mixed precision for speed
    "push_to_hub": False,
    "report_to": "none",
}

def load_training_data(filepath):
    """Load and prepare training data"""
    print(f"📂 Loading training data from {filepath}")
    
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    print(f"   Found {len(data)} training samples")
    
    # Convert to text format for language model
    texts = []
    for item in data:
        # Format: "Correct '[OCR_TEXT]' to '[CORRECTED_TEXT]' in [FIELD]"
        prompt = f"OCR extracted: {item['ocrText']}\nField: {item['field']}\nCorrect to:"
        completion = f" {item['correctedText']}"
        text = f"{prompt}{completion}"
        texts.append(text)
    
    return texts

def create_dataset(texts, tokenizer):
    """Create HuggingFace dataset from texts"""
    print("🔄 Creating dataset...")
    
    # Tokenize all texts
    tokenized = tokenizer(
        texts,
        truncation=True,
        padding="max_length",
        max_length=128,  # Short sequences for OCR corrections
        return_tensors="pt"
    )
    
    # Create dataset
    dataset = Dataset.from_dict({
        "input_ids": tokenized["input_ids"],
        "attention_mask": tokenized["attention_mask"]
    })
    
    print(f"   Created dataset with {len(dataset)} examples")
    return dataset

def setup_model_and_tokenizer(model_name):
    """Load base model and tokenizer, apply LoRA"""
    print(f"🤖 Loading model: {model_name}")
    
    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    
    # Load model
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else None,
        trust_remote_code=True
    )
    
    # Apply LoRA
    print("🔧 Applying LoRA adapters...")
    model = get_peft_model(model, LORA_CONFIG)
    model.print_trainable_parameters()
    
    return model, tokenizer

def train(model, tokenizer, dataset):
    """Fine-tune the model"""
    print("\n🚀 Starting training...")
    print(f"   Samples: {len(dataset)}")
    print(f"   Epochs: {TRAINING_CONFIG['num_train_epochs']}")
    print(f"   Batch size: {TRAINING_CONFIG['per_device_train_batch_size']}")
    
    # Training arguments
    training_args = TrainingArguments(**TRAINING_CONFIG)
    
    # Data collator
    data_collator = DataCollatorForLanguageModeling(
        tokenizer=tokenizer,
        mlm=False  # Causal LM, not masked LM
    )
    
    # Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        data_collator=data_collator,
    )
    
    # Train!
    trainer.train()
    
    print("✅ Training complete!")
    return trainer

def save_model(trainer, tokenizer, output_dir):
    """Save fine-tuned model"""
    print(f"\n💾 Saving model to {output_dir}")
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Save model (LoRA adapters only - much smaller!)
    trainer.model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    
    # Get model size
    adapter_size = sum(
        os.path.getsize(os.path.join(output_dir, f))
        for f in os.listdir(output_dir)
        if os.path.isfile(os.path.join(output_dir, f))
    ) / (1024 * 1024)  # MB
    
    print(f"   Saved! Size: {adapter_size:.1f} MB (LoRA adapters only)")
    print(f"   Location: {output_dir}")

def main():
    print("=" * 60)
    print("🧠 MedOCR Fine-Tuning Pipeline")
    print("=" * 60)
    print()
    
    # Check if CUDA available
    if torch.cuda.is_available():
        print(f"✅ GPU detected: {torch.cuda.get_device_name(0)}")
    elif torch.backends.mps.is_available():
        print(f"✅ Apple Silicon detected (MPS)")
    else:
        print("⚠️  No GPU detected - training on CPU (will be slow)")
    print()
    
    # Load training data
    texts = load_training_data(TRAINING_DATA)
    
    if len(texts) == 0:
        print("❌ No training data found!")
        return
    
    # Setup model
    model, tokenizer = setup_model_and_tokenizer(MODEL_NAME)
    
    # Create dataset
    dataset = create_dataset(texts, tokenizer)
    
    # Train
    trainer = train(model, tokenizer, dataset)
    
    # Save
    save_model(trainer, tokenizer, OUTPUT_DIR)
    
    print()
    print("=" * 60)
    print("✅ Fine-tuning complete!")
    print()
    print("Next steps:")
    print("1. Test the model: python training/llava/test_model.py")
    print("2. Compare accuracy with base model")
    print("3. If good, collect more data and retrain")
    print("=" * 60)

if __name__ == "__main__":
    main()
