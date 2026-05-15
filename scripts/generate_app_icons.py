from PIL import Image, ImageEnhance, ImageFilter
import os

# Configuration
SOURCE_ICON = r"e:\ERP System\Atlas\public\pwa-icon.png"
IOS_OUTPUT_DIR = r"e:\ERP System\Atlas\src-tauri\icons\ios"
ANDROID_RES_DIR = r"e:\ERP System\Atlas\src-tauri\gen\android\app\src\main\res"

# iOS Icon mapping: Filename -> Width (square)
IOS_ICON_SIZES = {
    "AppIcon-20x20@1x.png": 20,
    "AppIcon-20x20@2x.png": 40,
    "AppIcon-20x20@2x-1.png": 40,
    "AppIcon-20x20@3x.png": 60,
    "AppIcon-29x29@1x.png": 29,
    "AppIcon-29x29@2x.png": 58,
    "AppIcon-29x29@2x-1.png": 58,
    "AppIcon-29x29@3x.png": 87,
    "AppIcon-40x40@1x.png": 40,
    "AppIcon-40x40@2x.png": 80,
    "AppIcon-40x40@2x-1.png": 80,
    "AppIcon-40x40@3x.png": 120,
    "AppIcon-60x60@2x.png": 120,
    "AppIcon-60x60@3x.png": 180,
    "AppIcon-76x76@1x.png": 76,
    "AppIcon-76x76@2x.png": 152,
    "AppIcon-83.5x83.5@2x.png": 167,
    "AppIcon-512@2x.png": 1024,
}

# Android Icon densities mapping: Folder Name -> Base Size (square)
# Standard sizes: mdpi(48), hdpi(72), xhdpi(96), xxhdpi(144), xxxhdpi(192)
ANDROID_DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

ANDROID_FILENAMES = [
    "ic_launcher.png",
    "ic_launcher_round.png",
    "ic_launcher_foreground.png"
]

def enhance_image(img):
    """Applies enhancements to the source image before downscaling."""
    # Enhance sharpness
    sharpener = ImageEnhance.Sharpness(img)
    img = sharpener.enhance(1.5)
    
    # Enhance contrast slightly
    contrast = ImageEnhance.Contrast(img)
    img = contrast.enhance(1.1)
    
    return img

def generate_ios_icons(enhanced_source):
    print("--- Generating iOS Icons ---")
    if not os.path.exists(IOS_OUTPUT_DIR):
        os.makedirs(IOS_OUTPUT_DIR)
        print(f"Created: {IOS_OUTPUT_DIR}")
        
    for filename, size in IOS_ICON_SIZES.items():
        output_path = os.path.join(IOS_OUTPUT_DIR, filename)
        resized_img = enhanced_source.resize((size, size), Image.Resampling.LANCZOS)
        resized_img.save(output_path, "PNG")
        print(f"  Generated: {filename} ({size}x{size})")

def generate_android_icons(enhanced_source):
    print("\n--- Generating Android Icons ---")
    if not os.path.exists(ANDROID_RES_DIR):
        print(f"Error: Android resource directory not found at {ANDROID_RES_DIR}")
        return

    for folder, size in ANDROID_DENSITIES.items():
        target_dir = os.path.join(ANDROID_RES_DIR, folder)
        if not os.path.exists(target_dir):
            os.makedirs(target_dir)
            print(f"  Created: {target_dir}")
            
        for filename in ANDROID_FILENAMES:
            output_path = os.path.join(target_dir, filename)
            resized_img = enhanced_source.resize((size, size), Image.Resampling.LANCZOS)
            resized_img.save(output_path, "PNG")
            print(f"  Generated: {folder}/{filename} ({size}x{size})")

def main():
    if not os.path.exists(SOURCE_ICON):
        print(f"Error: Source icon not found at {SOURCE_ICON}")
        return

    with Image.open(SOURCE_ICON) as source:
        print(f"Source: {SOURCE_ICON} ({source.width}x{source.height})")
        enhanced_source = enhance_image(source)
        
        generate_ios_icons(enhanced_source)
        generate_android_icons(enhanced_source)

    print("\nAll app icons (iOS & Android) generated successfully!")

if __name__ == "__main__":
    main()
