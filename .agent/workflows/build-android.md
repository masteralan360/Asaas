---
description: how to build the Android APK
---

To build the Android APK for the ERP/POS system, follow these steps:

1. **Build the Web Application**
   This prepares the frontend files for the mobile container.
   ```powershell
   npm run build
   ```

2. **Sync with Android Project**
   This copies the built web assets and updates plugins in the native Android project.
   ```powershell
   npx cap sync android
   ```

3. **Generate the APK**
   You have two options to generate the actual file:

   **Option A: Using Android Studio (Recommended)**
   - Run `npx cap open android`
   - In Android Studio, go to **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**.
   - Once finished, a notification will appear with a "locate" link to find your APK.

   **Option B: Using Command Line (Quickest)**
   - Run the following command:
     ```powershell
     cd android; ./gradlew assembleDebug
     ```
   - Your APK will be located at: `android/app/build/outputs/apk/debug/app-debug.apk`

4. **Install on Device**
   - Transfer the `.apk` file to your Android phone and open it to install.
   - Alternatively, if your phone is connected via USB, run:
     ```powershell
     npx cap run android
     ```
