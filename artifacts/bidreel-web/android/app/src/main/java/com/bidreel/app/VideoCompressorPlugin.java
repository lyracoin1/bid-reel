package com.bidreel.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.media3.common.Effect;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.collect.ImmutableList;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Native pre-upload video compression for BidReel.
 *
 * Architecture:
 *   1. pickVideo() opens the system picker via ACTION_GET_CONTENT, copies the
 *      selected content:// stream into the app cache as a stable .mp4 file,
 *      extracts a JPEG thumbnail, and returns both file paths (plus their
 *      Capacitor convertFileSrc-resolved web URLs) so the JS layer can render
 *      a preview without going through base64.
 *   2. compressVideo() runs AndroidX Media3 Transformer to re-encode the
 *      picked video to H.264 + AAC inside an MP4 container at 720p / 2 Mbps,
 *      writes the result to cache, and returns its path + size. The same
 *      convertFileSrc URL pattern lets the JS layer fetch() the bytes for
 *      the existing R2 presigned-PUT upload pipeline.
 *
 * No raw-video fallback. If compression fails, the JS layer surfaces an
 * error and the upload never starts.
 */
@CapacitorPlugin(name = "VideoCompressor")
public class VideoCompressorPlugin extends Plugin {

  private static final String TAG = "VideoCompressor";

  // ────────────────────────────────────────────────────────────────────────
  // isAvailable — JS feature-detect entry point
  // ────────────────────────────────────────────────────────────────────────

  @PluginMethod
  public void isAvailable(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("available", true);
    ret.put("platform", "android");
    call.resolve(ret);
  }

  // ────────────────────────────────────────────────────────────────────────
  // pickVideo — open system picker, copy to cache, extract thumbnail
  // ────────────────────────────────────────────────────────────────────────

  @PluginMethod
  public void pickVideo(PluginCall call) {
    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
    intent.setType("video/*");
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    startActivityForResult(call, intent, "videoPickedCallback");
  }

  @ActivityCallback
  private void videoPickedCallback(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null
        || result.getData().getData() == null) {
      call.reject("USER_CANCELLED");
      return;
    }
    final Uri uri = result.getData().getData();

    // Copy + thumbnail extraction is disk-bound; keep it off the UI thread.
    new Thread(() -> {
      MediaMetadataRetriever mmr = null;
      try {
        File cacheDir = getContext().getCacheDir();
        long stamp = System.currentTimeMillis();
        File inputFile = new File(cacheDir, "bidreel_input_" + stamp + ".mp4");
        File thumbFile = new File(cacheDir, "bidreel_thumb_" + stamp + ".jpg");

        // 1. Stream the picked content:// URI into a stable file.
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(inputFile)) {
          if (in == null) throw new IOException("ContentResolver returned null InputStream");
          byte[] buf = new byte[64 * 1024];
          int n;
          while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }

        // 2. Extract poster frame + intrinsic metadata.
        mmr = new MediaMetadataRetriever();
        mmr.setDataSource(inputFile.getAbsolutePath());
        Bitmap bmp = mmr.getFrameAtTime(0L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
        if (bmp != null) {
          try (FileOutputStream fos = new FileOutputStream(thumbFile)) {
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, fos);
          } finally {
            bmp.recycle();
          }
        }

        String widthStr  = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
        String heightStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
        String durStr    = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
        int width  = widthStr  != null ? Integer.parseInt(widthStr)  : 0;
        int height = heightStr != null ? Integer.parseInt(heightStr) : 0;
        long durationMs = durStr != null ? Long.parseLong(durStr) : 0L;

        JSObject ret = new JSObject();
        ret.put("inputPath", inputFile.getAbsolutePath());
        if (bmp != null) {
          ret.put("thumbnailPath", thumbFile.getAbsolutePath());
        }
        ret.put("sizeBytes", inputFile.length());
        ret.put("durationMs", durationMs);
        ret.put("width", width);
        ret.put("height", height);
        call.resolve(ret);

      } catch (Exception e) {
        Log.e(TAG, "pickVideo failed", e);
        call.reject("PICK_FAILED: " + e.getMessage(), e);
      } finally {
        if (mmr != null) {
          try { mmr.release(); } catch (Exception ignore) {}
        }
      }
    }, "VideoCompressor-pick").start();
  }

  // ────────────────────────────────────────────────────────────────────────
  // compressVideo — Media3 Transformer (H.264 / AAC / MP4)
  // ────────────────────────────────────────────────────────────────────────

  @PluginMethod
  public void compressVideo(PluginCall call) {
    final String inputPath = call.getString("inputPath");
    if (inputPath == null || inputPath.isEmpty()) {
      call.reject("MISSING_INPUT_PATH");
      return;
    }
    final File inputFile = new File(inputPath);
    if (!inputFile.exists() || inputFile.length() == 0) {
      call.reject("INPUT_FILE_MISSING_OR_EMPTY: " + inputPath);
      return;
    }

    final int maxHeight = call.getInt("maxHeight", 720);
    final int bitrate   = call.getInt("videoBitrateBps", 2_000_000);

    final long startedAt = System.currentTimeMillis();
    final File outputFile = new File(
        getContext().getCacheDir(),
        "bidreel_compressed_" + startedAt + ".mp4"
    );

    // Media3 Transformer must be created and started on the main looper.
    new Handler(Looper.getMainLooper()).post(() -> {
      try {
        MediaItem mediaItem = MediaItem.fromUri(Uri.fromFile(inputFile));

        ImmutableList<Effect> videoEffects =
            ImmutableList.of(Presentation.createForHeight(maxHeight));

        EditedMediaItem editedItem = new EditedMediaItem.Builder(mediaItem)
            .setEffects(new Effects(ImmutableList.of(), videoEffects))
            .build();

        DefaultEncoderFactory encoderFactory =
            new DefaultEncoderFactory.Builder(getContext())
                .setRequestedVideoEncoderSettings(
                    new VideoEncoderSettings.Builder()
                        .setBitrate(bitrate)
                        .build()
                )
                .build();

        final Transformer transformer = new Transformer.Builder(getContext())
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setEncoderFactory(encoderFactory)
            .addListener(new Transformer.Listener() {
              @Override
              public void onCompleted(Composition composition, ExportResult exportResult) {
                long durationMs = System.currentTimeMillis() - startedAt;
                long size = outputFile.length();
                Log.i(TAG, "Compression OK: " + size + "B in " + durationMs + "ms → "
                    + outputFile.getAbsolutePath());

                JSObject ret = new JSObject();
                ret.put("outputPath", outputFile.getAbsolutePath());
                ret.put("sizeBytes", size);
                ret.put("durationMs", durationMs);
                call.resolve(ret);
              }

              @Override
              public void onError(Composition composition,
                                  ExportResult exportResult,
                                  ExportException exportException) {
                Log.e(TAG, "Compression FAILED", exportException);
                // Best-effort cleanup of partial output.
                if (outputFile.exists()) outputFile.delete();
                call.reject(
                    "COMPRESSION_FAILED: " + exportException.getMessage(),
                    String.valueOf(exportException.errorCode),
                    exportException
                );
              }
            })
            .build();

        // Progress polling — emit a 0-100 integer every 250ms while available.
        final ProgressHolder progressHolder = new ProgressHolder();
        final Handler progressHandler = new Handler(Looper.getMainLooper());
        progressHandler.post(new Runnable() {
          @Override public void run() {
            int state = transformer.getProgress(progressHolder);
            if (state == Transformer.PROGRESS_STATE_AVAILABLE) {
              JSObject p = new JSObject();
              p.put("progress", progressHolder.progress);
              notifyListeners("compressProgress", p);
            }
            if (state != Transformer.PROGRESS_STATE_NOT_STARTED) {
              progressHandler.postDelayed(this, 250);
            }
          }
        });

        transformer.start(editedItem, outputFile.getAbsolutePath());

      } catch (Exception e) {
        Log.e(TAG, "compressVideo setup failed", e);
        if (outputFile.exists()) outputFile.delete();
        call.reject("COMPRESSION_SETUP_FAILED: " + e.getMessage(), e);
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────
  // readFileAsBase64 — bulletproof file readback for upload
  //
  // Why base64 instead of `Capacitor.convertFileSrc(...) + fetch()`:
  // Capacitor.convertFileSrc resolves to https://localhost/_capacitor_file_/...
  // but this app's webview loads its page from `server.url`
  // (https://www.bid-reel.com), so a fetch from that origin to localhost is
  // cross-origin. Capacitor's WebViewLocalServer DOES emit
  // `Access-Control-Allow-Origin: *`, but WebView versions and CSPs in the
  // wild are inconsistent enough that we don't want the upload pipeline to
  // depend on cross-origin assumptions. Returning base64 over the standard
  // bridge channel always works.
  // ────────────────────────────────────────────────────────────────────────

  @PluginMethod
  public void readFileAsBase64(PluginCall call) {
    final String path = call.getString("path");
    if (path == null || path.isEmpty()) {
      call.reject("MISSING_PATH");
      return;
    }
    final File file = new File(path);
    if (!file.exists() || file.length() == 0) {
      call.reject("FILE_MISSING_OR_EMPTY: " + path);
      return;
    }

    new Thread(() -> {
      try (FileInputStream fis = new FileInputStream(file);
           ByteArrayOutputStream baos = new ByteArrayOutputStream((int) file.length())) {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = fis.read(buf)) > 0) baos.write(buf, 0, n);
        String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);

        JSObject ret = new JSObject();
        ret.put("base64", b64);
        ret.put("sizeBytes", file.length());
        call.resolve(ret);
      } catch (Exception e) {
        Log.e(TAG, "readFileAsBase64 failed", e);
        call.reject("READ_FAILED: " + e.getMessage(), e);
      }
    }, "VideoCompressor-read").start();
  }
}
