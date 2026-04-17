package com.bidreel.app;

import android.os.Bundle;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Register custom Capacitor plugins BEFORE super.onCreate so the bridge
    // initializes them alongside the auto-discovered ones.
    registerPlugin(VideoCompressorPlugin.class);
    registerPlugin(VolumeButtonsPlugin.class);
    super.onCreate(savedInstanceState);
  }

  /**
   * Hardware volume buttons are intercepted by the Android system before
   * `keydown` ever reaches the WebView, so a JS-only listener will NEVER
   * see them on a real device.  We override dispatchKeyEvent at the Activity
   * level — that fires for EVERY key event, including volume — and forward
   * UP/DOWN presses to {@link VolumeButtonsPlugin}.
   *
   * We intentionally fall through to super so the OS still adjusts stream
   * volume and shows its native HUD.  We never consume the event.
   */
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
