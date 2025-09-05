#!/usr/bin/env python3
"""
Generate realistic sleep study document images for OCR testing
"""

from PIL import Image, ImageDraw, ImageFont
import textwrap
import os

def create_document_image(text_content, output_filename, width=850, height=1100):
    """Create a document-like image from text content"""
    
    # Create white background
    img = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(img)
    
    # Try to use a more realistic font, fallback to default
    try:
        # Try common system fonts
        font_title = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", 16)
        font_header = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", 14)
        font_body = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", 12)
        font_small = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", 10)
    except:
        try:
            # Fallback fonts
            font_title = ImageFont.truetype("arial.ttf", 16)
            font_header = ImageFont.truetype("arial.ttf", 14)
            font_body = ImageFont.truetype("arial.ttf", 12) 
            font_small = ImageFont.truetype("arial.ttf", 10)
        except:
            # Use default font
            font_title = ImageFont.load_default()
            font_header = ImageFont.load_default()
            font_body = ImageFont.load_default()
            font_small = ImageFont.load_default()
    
    # Starting position
    x, y = 50, 50
    line_spacing = 18
    
    # Process text line by line
    lines = text_content.split('\n')
    
    for line in lines:
        if not line.strip():
            y += line_spacing // 2
            continue
            
        # Determine font based on line content
        current_font = font_body
        if line.isupper() and len(line) < 50:
            current_font = font_header
        elif any(keyword in line.upper() for keyword in ['PATIENT', 'SLEEP', 'REPORT', 'REFERRAL', 'CONSULTATION']):
            if len(line) < 30:
                current_font = font_title
        
        # Wrap long lines
        if len(line) > 70:
            wrapped_lines = textwrap.wrap(line, width=70)
            for wrapped_line in wrapped_lines:
                if y > height - 100:  # Near bottom
                    break
                draw.text((x, y), wrapped_line, fill='black', font=current_font)
                y += line_spacing
        else:
            if y > height - 100:  # Near bottom
                break
            draw.text((x, y), line, fill='black', font=current_font)
            y += line_spacing
    
    # Add some document-like elements (border, etc.)
    draw.rectangle([25, 25, width-25, height-25], outline='black', width=2)
    
    # Save the image
    img.save(output_filename, 'PNG', dpi=(300, 300))
    print(f"Created document image: {output_filename}")

def main():
    # List of text files to convert
    text_files = [
        ('test_sleep_referral.txt', 'test_sleep_referral.png'),
        ('test_cpap_report.txt', 'test_cpap_report.png'),
        ('test_psg_report.txt', 'test_psg_report.png'),
        ('test_hsat_report.txt', 'test_hsat_report.png'),
        ('test_insomnia_consult.txt', 'test_insomnia_consult.png')
    ]
    
    for text_file, image_file in text_files:
        if os.path.exists(text_file):
            with open(text_file, 'r') as f:
                content = f.read()
            create_document_image(content, image_file)
        else:
            print(f"Warning: {text_file} not found")

if __name__ == "__main__":
    main()
