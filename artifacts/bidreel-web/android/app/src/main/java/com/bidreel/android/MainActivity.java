package com.bidreel.android;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.PermissionRequest;

import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

// ✅ مهم جدًا — إضافات plugins
import com.bidreel.app.VideoCompressorPlugin;
import com.bidreel.app.VolumeButtonsPlugin;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Register custom Capacitor plugins BEFORE super.onCreate
    registerPlugin(VideoCompressorPlugin.class);
    registerPlugin(VolumeButtonsPlugin.class);
    super.onCreate(savedInstanceState);

    // ── WebView audio capture grant ──────────────────────────────────────────
    // On many OEM ROMs (Samsung/Xiaomi/Huawei), Capacitor's default
    // BridgeWebChromeClient silently blocks WebView-level getUserMedia even
    // when the OS RECORD_AUDIO permission is already granted by the user.
    // We extend BridgeWebChromeClient so all Capacitor behaviour is preserved,
    // and add an explicit grant for RESOURCE_AUDIO_CAPTURE whenever the OS
    // permission is confirmed held.
    this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        boolean needsAudio = false;
        for (String resource : request.getResources()) {
          if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
            needsAudio = true;
            break;
          }
        }

        if (needsAudio && ContextCompat.checkSelfPermission(
              MainActivity.this, Manifest.permission.RECORD_AUDIO)
              == PackageManager.PERMISSION_GRANTED) {
          // OS has already granted RECORD_AUDIO — forward the grant to the
          // WebView immediately so getUserMedia() resolves instead of throwing
          // NotAllowedError.
          request.grant(request.getResources());
          return;
        }

        // Fallback: let Capacitor's default logic handle all other cases
        // (video, notifications, cases where audio is not yet granted).
        super.onPermissionRequest(request);
      }
    });
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    if (event != null && event.getAction() == KeyEvent.ACTION_DOWN) {
      int code = event.getKeyCode();
      if (code == KeyEvent.KEYCODE_VOLUME_UP) {
        VolumeButtonsPlugin.emitVolumePress("up");
      } else if (code == KeyEvent.KEYCODE_VOLUME_DOWN) {
        VolumeButtonsPlugin.emitVolumePress("down");
      }
    }
    return super.dispatchKeyEvent(event);
  }
}
