package com.atlas.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    
    // Explicitly fetch FCM token on startup
    com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
      if (!task.isSuccessful) {
        android.util.Log.w("MainActivity", "Fetching FCM registration token failed", task.exception)
        return@addOnCompleteListener
      }
      try {
        val token = task.result
        val file = java.io.File(filesDir, "fcm-token.txt")
        file.writeText(token)
        android.util.Log.d("MainActivity", "FCM token saved on startup")
      } catch (e: Exception) {
        android.util.Log.e("MainActivity", "Failed to persist FCM token", e)
      }
    }
  }
}
