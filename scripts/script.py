from PIL import Image, ImageEnhance, ImageFilter

# Load image
img_path = "/mnt/data/AppIcon-512@2x.png"
img = Image.open(img_path)

# Upscale 2x using high quality resampling
upscaled = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)

# Enhance sharpness
sharpener = ImageEnhance.Sharpness(upscaled)
upscaled = sharpener.enhance(2.0)

# Enhance contrast slightly
contrast = ImageEnhance.Contrast(upscaled)
upscaled = contrast.enhance(1.2)

# Enhance color slightly
color = ImageEnhance.Color(upscaled)
upscaled = color.enhance(1.1)

# Apply slight smoothing then re-sharpen (denoise-ish effect)
upscaled = upscaled.filter(ImageFilter.MedianFilter(size=3))
upscaled = ImageEnhance.Sharpness(upscaled).enhance(1.5)

output_path = "/mnt/data/enhanced_icon.png"
upscaled.save(output_path)

output_path