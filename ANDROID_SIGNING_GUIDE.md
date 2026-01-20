# Android Release Signing Configuration

To automate APK signing on GitHub, add the following secrets to your repository.

## GitHub Secrets Checklist
Go to **Settings** > **Secrets and variables** > **Actions** > **New repository secret** and add:

- **ANDROID_KEYSTORE_BASE64**: 
  (Copy the long string from your terminal or I can provide it again)
- **ANDROID_KEY_PASSWORD**: `password122333`
- **ANDROID_KEY_ALIAS**: `iraqcore`

## Environment Variables (.env)
Add these to your local `.env` and `.env.example` for reference:

# Android Release Signing
ANDROID_KEY_ALIAS=iraqcore
ANDROID_KEY_PASSWORD=password122333
ANDROID_KEYSTORE_PASSWORD=password122333
