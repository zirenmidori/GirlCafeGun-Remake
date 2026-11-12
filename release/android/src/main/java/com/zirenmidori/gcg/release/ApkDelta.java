package com.zirenmidori.gcg.release;

import android.app.PendingIntent;
import android.content.*;
import android.content.pm.*;
import android.os.Build;
import org.json.*;
import java.io.*;
import java.util.zip.*;

public final class ApkDelta {
    private ApkDelta(){}
    public static long version(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
    public static long installedVersion(Context c)throws IOException{
        try{return version(c.getPackageManager().getPackageInfo(c.getPackageName(),0));}catch(PackageManager.NameNotFoundException e){throw new IOException(e);}
    }
    private static String certificate(PackageInfo p)throws IOException{
        android.content.pm.Signature[] signatures=Build.VERSION.SDK_INT>=28&&p.signingInfo!=null?p.signingInfo.getApkContentsSigners():p.signatures;
        if(signatures==null||signatures.length!=1)throw new IOException("Expected exactly one APK signer");
        return ReleaseIO.hex(ReleaseIO.digest().digest(signatures[0].toByteArray()));
    }
    public static boolean alreadyInstalled(Context c,JSONObject apk)throws IOException{
        try{return ReleaseIO.sha(new File(c.getApplicationInfo().sourceDir)).equals(ReleaseManifest.digest(apk.getString("targetSha256")));}
        catch(JSONException e){throw new IOException(e);}
    }
    public static File reconstruct(Context c,ZipFile update,JSONObject spec,ReleaseDownload.Progress progress)throws IOException{
        try{
            File output=ApkDeltaBytes.reconstruct(new File(c.getApplicationInfo().sourceDir),new File(ReleaseStore.root(c),"candidate.apk"),update,spec,progress);
            PackageManager pm=c.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
            PackageInfo candidate=pm.getPackageArchiveInfo(output.getAbsolutePath(),flags),installed=pm.getPackageInfo(c.getPackageName(),flags);
            String expected=ReleaseManifest.digest(spec.getString("certificateSha256"));
            if(candidate==null||!c.getPackageName().equals(candidate.packageName)||version(candidate)!=ReleaseManifest.number(spec,"versionCode")||version(candidate)<=version(installed)||!certificate(candidate).equals(expected)||!certificate(installed).equals(expected))throw new IOException("APK package, version or signing identity is not an allowed update");
            return output;
        }catch(JSONException|PackageManager.NameNotFoundException e){throw new IOException("Invalid APK delta",e);}
    }
    public static void install(Context c,File candidate)throws IOException{
        PackageInstaller installer=c.getPackageManager().getPackageInstaller();PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);params.setAppPackageName(c.getPackageName());params.setSize(candidate.length());
        if(Build.VERSION.SDK_INT>=31)params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        int id=installer.createSession(params);
        try(PackageInstaller.Session session=installer.openSession(id);InputStream in=new FileInputStream(candidate)){
            try(OutputStream out=session.openWrite("base.apk",0,candidate.length())){byte[] buffer=new byte[131072];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);session.fsync(out);}
            Intent result=new Intent(c,InstallResultReceiver.class);int flags=PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0);
            session.commit(PendingIntent.getBroadcast(c,id,result,flags).getIntentSender());
        }catch(IOException|RuntimeException e){installer.abandonSession(id);throw e;}
    }
}
