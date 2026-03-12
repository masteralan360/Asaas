package com.asaas.app

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService

class FcmTokenService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    super.onNewToken(token)
    try {
      val file = java.io.File(filesDir, "fcm-token.txt")
      file.writeText(token)
    } catch (e: Exception) {
      Log.e("FcmTokenService", "Failed to persist FCM token", e)
    }
  }
}

