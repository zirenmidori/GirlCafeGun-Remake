package com.yricky.gcg2.embedded;

import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.os.Process;
import android.util.Log;
import java.io.File;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;

public final class GcgServerService extends Service {
    private static final String TAG = "GcgEmbeddedServer";
    private static final int MIN_RUNTIME_API = 24;
    private static final long NODE_STACK_BYTES = 8L * 1024 * 1024;
    private static final AtomicBoolean NODE_ENTRY_USED = new AtomicBoolean();
    private final IBinder binder = new Binder();
    private boolean stopping;
    private boolean nativeActive;
    private boolean enteredNode;

    static boolean isSupported() {
        if (Build.VERSION.SDK_INT < MIN_RUNTIME_API) return false;
        for (String abi : Build.SUPPORTED_ABIS) {
            if ("arm64-v8a".equals(abi) || "armeabi-v7a".equals(abi)) return true;
        }
        return false;
    }

    @Override public void onCreate() {
        super.onCreate();
        new Thread(null, this::startRuntime, "GcgNode", NODE_STACK_BYTES).start();
    }

    @Override public IBinder onBind(Intent intent) {
        return binder;
    }

    private void startRuntime() {
        if (!isSupported()) return;
        try {
            File root = ServerPayload.root(this);
            File state = ServerPayload.regularFilePath(ServerPayload.directory(root, "data"), "state.json");
            File log = ServerPayload.regularFilePath(ServerPayload.directory(root, "logs"), "server.log");
            File payload = ServerPayload.install(this, root);
            System.loadLibrary("node");
            System.loadLibrary("gcg_embedded");
            synchronized (this) {
                if (stopping) return;
                if (!NODE_ENTRY_USED.compareAndSet(false, true)) {
                    throw new IllegalStateException("The Node runtime has already run in this process");
                }
                nativeActive = true;
                enteredNode = true;
            }
            int result = runNode(payload.getAbsolutePath(), state.getAbsolutePath(), log.getAbsolutePath());
            if (result != 0) Log.e(TAG, "Node stopped with status " + result);
        } catch (IOException | RuntimeException | LinkageError error) {
            Log.e(TAG, "Local server could not start", error);
        } finally {
            synchronized (this) {
                nativeActive = false;
            }
        }
    }

    @Override public void onDestroy() {
        boolean active;
        boolean used;
        synchronized (this) {
            stopping = true;
            active = nativeActive;
            used = enteredNode;
        }
        super.onDestroy();
        // The manifest runs this service in :gcgserver, separate from Unity.
        // Let Node flush its save on a normal unbind. A used Node process is not reusable.
        if (active) Process.sendSignal(Process.myPid(), 15);
        else if (used) Process.killProcess(Process.myPid());
    }

    private static native int runNode(String payloadDir, String statePath, String logPath);
}
