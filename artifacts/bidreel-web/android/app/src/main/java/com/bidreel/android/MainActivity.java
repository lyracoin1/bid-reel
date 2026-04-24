package com.bidreel.android;

import android.os.Bundle;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

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