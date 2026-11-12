package com.zirenmidori.gcg.release;
import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.util.zip.ZipFile;
/** Host-only package-manager boundary. APK byte reconstruction uses the real production class. */
public final class ApkDelta {
    public static long installedVersion(Context c){return 10137;}
    public static boolean alreadyInstalled(Context c,JSONObject apk)throws IOException{throw new IOException("APK Android boundary is not emulated");}
    public static File reconstruct(Context c,ZipFile z,JSONObject s,ReleaseDownload.Progress p)throws IOException{throw new IOException("APK Android boundary is not emulated");}
}
