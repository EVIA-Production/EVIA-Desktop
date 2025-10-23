#!/usr/bin/env python3
"""
Apple HIG Icon Processor
Converts any icon to Apple-compliant 1024x1024 with rounded corners (21.5% radius)
Automatically detects and removes grey borders
"""
import os
import sys
from PIL import Image, ImageDraw

def round_icon(input_path, output_path, crop_border=True):
    """Process icon to Apple HIG specifications"""
    
    # Load image
    print(f"Loading: {input_path}")
    img = Image.open(input_path)
    print(f"Original size: {img.size}, mode: {img.mode}")
    
    # Convert to RGBA early for border detection
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
        print(f"Converted to RGBA mode")
    
    # Auto-crop grey borders by finding the actual content
    if crop_border:
        print("Detecting and removing grey borders...")
        pixels = img.load()
        width, height = img.size
        
        # Find the bounding box of non-grey content
        # Grey is typically RGB(200-245, 200-245, 200-245)
        min_x, min_y = width, height
        max_x, max_y = 0, 0
        
        for y in range(height):
            for x in range(width):
                r, g, b = pixels[x, y][:3]
                # If pixel is NOT grey (not in 225-245 range for all channels)
                # Tightened range to be more aggressive
                if not (225 <= r <= 245 and 225 <= g <= 245 and 225 <= b <= 245):
                    min_x = min(min_x, x)
                    min_y = min(min_y, y)
                    max_x = max(max_x, x)
                    max_y = max(max_y, y)
        
        if min_x < width and min_y < height:
            # Add small padding (1%) to avoid cutting too close
            padding = int(width * 0.01)
            min_x = max(0, min_x - padding)
            min_y = max(0, min_y - padding)
            max_x = min(width - 1, max_x + padding)
            max_y = min(height - 1, max_y + padding)
            
            # Crop to content
            old_size = (width, height)
            img = img.crop((min_x, min_y, max_x + 1, max_y + 1))
            print(f"✂️  Border removed - new size: {img.size} (was {old_size})")
        else:
            print("⚠️  No grey border detected - skipping crop")
    
    # Target size for macOS icons
    target_size = 1024
    
    # Convert to square by cropping to center (if needed)
    width, height = img.size
    if width != height:
        # Crop to square (center crop)
        min_dim = min(width, height)
        left = (width - min_dim) // 2
        top = (height - min_dim) // 2
        right = left + min_dim
        bottom = top + min_dim
        img = img.crop((left, top, right, bottom))
        print(f"Cropped to square: {img.size}")
    
    # Resize to 1024x1024 if needed
    if img.size != (target_size, target_size):
        img = img.resize((target_size, target_size), Image.Resampling.LANCZOS)
        print(f"Resized to: {img.size}")
    
    # Create rounded corner mask
    size = img.size[0]  # Should be 1024
    
    # Apple's squircle formula: 21.5% of the icon size
    radius_percentage = 0.215
    corner_radius = int(size * radius_percentage)  # ~220px for 1024
    
    print(f"Applying corner radius: {corner_radius}px ({radius_percentage * 100}%)")
    
    # Create mask for rounded corners
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (size, size)], radius=corner_radius, fill=255)
    
    # Apply mask to alpha channel
    alpha = img.split()[3] if img.mode == 'RGBA' else Image.new('L', img.size, 255)
    alpha = Image.composite(alpha, Image.new('L', img.size, 0), mask)
    img.putalpha(alpha)
    
    # Save
    img.save(output_path, 'PNG')
    print(f"✅ Saved: {output_path}")
    print(f"Final size: {img.size}, mode: {img.mode}")
    return True

if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Process icon to Apple HIG specs')
    parser.add_argument('-i', '--input', help='Input icon path')
    parser.add_argument('-o', '--output', help='Output icon path')
    parser.add_argument('--no-crop', action='store_true', help='Skip border cropping')
    args = parser.parse_args()
    
    # Find project root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    
    # Default paths
    input_icon = args.input if args.input else os.path.join(project_root, 'src/main/assets/icon3.png')
    output_icon = args.output if args.output else os.path.join(project_root, 'src/main/assets/icon.png')
    crop_border = not args.no_crop
    
    print("=" * 60)
    print("🎨 Apple HIG Icon Processor")
    print("=" * 60)
    print(f"Input:  {input_icon}")
    print(f"Output: {output_icon}")
    print(f"Border crop: {'YES' if crop_border else 'NO'}")
    print()
    
    try:
        round_icon(input_icon, output_icon, crop_border=crop_border)
        print()
        print("=" * 60)
        print("✅ Icon processing complete!")
        print("=" * 60)
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
