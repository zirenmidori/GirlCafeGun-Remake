package com.zirenmidori.gcg.release;

import android.content.*;
import android.content.pm.PackageInstaller;
import org.json.JSONObject;

public final class InstallResultReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent){
        int status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);
        try{
            if(status==PackageInstaller.STATUS_PENDING_USER_ACTION){Intent approval=intent.getParcelableExtra(Intent.EXTRA_INTENT);if(approval!=null){approval.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);c.startActivity(approval);}return;}
            ReleaseStore.writeJson(new java.io.File(ReleaseStore.root(c),"installer-result.json"),new JSONObject().put("status",status).put("message",intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)));
            if(status!=PackageInstaller.STATUS_SUCCESS){
                // No resource publication has begun at this phase. Cancellation must
                // leave the previous playable app/data release available.
                new java.io.File(ReleaseStore.root(c),"pending.gcgupdate").delete();
                new java.io.File(ReleaseStore.root(c),"candidate.apk").delete();
            }
            Intent ui=new Intent(c,UpdateActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);ui.putExtra("installerStatus",status);c.startActivity(ui);
        }catch(Exception e){android.util.Log.e("GcgRelease","Could not show installer result",e);}
    }
}
