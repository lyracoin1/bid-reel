package com.bidreel.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "VolumeButtons")
public class VolumeButtonsPlugin extends Plugin {

  private static VolumeButtonsPlugin INSTANCE;

  @Override
  public void load() {
    INSTANCE = this;
  }

  @Override
  protected void handleOnDestroy() {
    if (INSTANCE == this) INSTANCE = null;
    super.handleOnDestroy();
  }

  @PluginMethod
  public void ping(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("ok", true);
    call.resolve(ret);
  }

  /**
   * Called from MainActivity.dispatchKeyEvent when a hardware volume key is
   * pressed. We do NOT consume the event — the OS still shows the volume HUD
   * and adjusts stream volume. We only mirror the press to JS as an event.
   *
   * direction: "up" or "down".
   */
  public static void emitVolumePress(String direction) {
    VolumeButtonsPlugin inst = INSTANCE;
    if (inst == null) return;
    JSObject data = new JSObject();
    data.put("direction", direction);
    inst.notifyListeners("volumePressed", data, true);
  }
}
