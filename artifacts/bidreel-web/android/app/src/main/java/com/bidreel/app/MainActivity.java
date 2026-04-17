package com.bidreel.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Register custom Capacitor plugins BEFORE super.onCreate so the bridge
    // initializes them alongside the auto-discovered ones.
    registerPlugin(VideoCompressorPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
