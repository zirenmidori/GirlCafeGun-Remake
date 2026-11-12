package com.zirenmidori.gcg.release;

import android.app.Activity;
import android.content.*;
import android.os.*;
import android.os.Process;

public final class ReleaseBridge {
    public static final String ACCOUNT="gcg-offline-player-v1";
    private ReleaseBridge(){}
    private static Activity activity(){
        try{return(Activity)Class.forName("com.unity3d.player.UnityPlayer").getField("currentActivity").get(null);}
        catch(ReflectiveOperationException e){throw new IllegalStateException("Unity activity is unavailable",e);}
    }
    public static String getAccount(){return getAccount(activity());}
    public static void prepareAccount(){getAccount(activity());}
    public static String getAccount(Context context){
        android.content.SharedPreferences prefs=context.getSharedPreferences("release.identity",Context.MODE_PRIVATE);
        if(!ACCOUNT.equals(prefs.getString("account",null))&&!prefs.edit().putString("account",ACCOUNT).commit())throw new IllegalStateException("Cannot persist local account identity");
        return ACCOUNT;
    }
    public static void requestUpdate(){
        Activity a=activity();a.runOnUiThread(()->{
            Intent update=new Intent(a,UpdateActivity.class).putExtra("gamePid",Process.myPid()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            a.startActivity(update);
            // The updater owns its own process, so game code and all loaded bundles are cold.
            new Handler(Looper.getMainLooper()).postDelayed(()->Process.killProcess(Process.myPid()),800);
        });
    }
}
