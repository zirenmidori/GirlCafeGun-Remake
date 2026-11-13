package com.yricky.gcg2.embedded;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.os.*;
import android.view.*;
import android.widget.*;
import com.zirenmidori.gcg.release.*;
import java.io.*;
import java.net.*;
import java.util.concurrent.*;
import org.json.*;

/** Local-only bootstrap. Unity never runs before recovery and data provisioning. */
public final class BootActivity extends Activity {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private TextView status,downloadSummary;private Button retry;
    private ProgressBar downloadProgress,working;
    private boolean launched,starting;private volatile boolean closed;
    private long lastFileDetail;
    private volatile CountDownLatch downloadDecision;
    private AlertDialog downloadDialog;
    private final class BootProgress implements ReleaseDownload.DetailedProgress {
        @Override public void show(String text){BootActivity.this.show(text);}
        @Override public void bytes(long complete,long total){showBytes(complete,total);}
        @Override public void confirmInitialDownload(long totalDownloadBytes,long expandedBytes)throws IOException{confirmDownload(totalDownloadBytes,expandedBytes);}
    }
    private static boolean bound;
    private static final ServiceConnection CONNECTION=new ServiceConnection(){
        @Override public void onServiceConnected(ComponentName name,IBinder binder){}
        @Override public void onServiceDisconnected(ComponentName name){}
        @Override public void onBindingDied(ComponentName name){bound=false;}
        @Override public void onNullBinding(ComponentName name){bound=false;}
    };
    @Override public void onCreate(Bundle state){
        super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinearLayout view=new LinearLayout(this);view.setOrientation(LinearLayout.VERTICAL);view.setPadding(48,32,48,32);view.setGravity(Gravity.CENTER);
        view.setBackgroundColor(android.graphics.Color.rgb(22,26,39));
        TextView title=new TextView(this);title.setText("Girl Cafe Gun");title.setTextSize(26);title.setTextColor(android.graphics.Color.WHITE);title.setGravity(Gravity.CENTER);view.addView(title);
        status=new TextView(this);status.setText("Preparing game data…");status.setTextSize(18);view.addView(status);
        status.setTextColor(android.graphics.Color.WHITE);status.setGravity(Gravity.CENTER);
        downloadProgress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);downloadProgress.setIndeterminate(false);downloadProgress.setMax(1000);downloadProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(android.graphics.Color.rgb(158,128,255)));downloadProgress.setVisibility(View.GONE);view.addView(downloadProgress,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT));
        downloadSummary=new TextView(this);downloadSummary.setTextSize(18);downloadSummary.setTextColor(android.graphics.Color.WHITE);downloadSummary.setGravity(Gravity.CENTER);downloadSummary.setVisibility(View.GONE);view.addView(downloadSummary);
        working=new ProgressBar(this);view.addView(working);
        retry=new Button(this);retry.setText("Retry");retry.setVisibility(View.GONE);retry.setOnClickListener(v->begin());view.addView(retry);setContentView(view);begin();
    }
    private void showNow(String text){runOnUiThread(()->{if(!closed)status.setText(text);});}
    private void show(String text){
        // The initial inventory contains over 22,000 files. Coalesce fast file
        // detail changes without dropping phase changes or error messages.
        if(text.startsWith("Checking existing data: ")||text.startsWith("Preparing ")){
            long now=SystemClock.elapsedRealtime();if(now-lastFileDetail<200)return;lastFileDetail=now;
        }
        showNow(text);
    }
    private static String size(long bytes){return bytes>=1000000000L?String.format(java.util.Locale.US,"%.2f GB",bytes/1000000000.0):String.format(java.util.Locale.US,"%.0f MiB",bytes/1048576.0);}
    private void showBytes(long complete,long total){
        if(total<=0)return;
        final long done=Math.max(0,Math.min(complete,total));
        final int position=(int)(1000L*done/total);
        final String text=String.format(java.util.Locale.US,"%.1f%%  ·  %s / %s downloaded",100.0*done/total,size(done),size(total));
        runOnUiThread(()->{if(!closed){working.setVisibility(View.GONE);downloadProgress.setVisibility(View.VISIBLE);downloadSummary.setVisibility(View.VISIBLE);downloadProgress.setProgress(position);downloadSummary.setText(text);}});
    }
    private void hideProgress(){working.setVisibility(View.GONE);downloadProgress.setVisibility(View.GONE);downloadSummary.setVisibility(View.GONE);}
    private void confirmDownload(long totalDownloadBytes,long expandedBytes)throws IOException{
        final String manifestHash;
        try(InputStream in=getAssets().open("gcg-release/manifest.json")){manifestHash=ReleaseIO.hex(ReleaseIO.digest().digest(ReleaseIO.read(in,16L*1024*1024)));}
        final SharedPreferences approval=getSharedPreferences("gcg-release-download",MODE_PRIVATE);
        if(manifestHash.equals(approval.getString("approvedManifestSha256","")))return;
        if(closed||Thread.currentThread().isInterrupted())throw new IOException("Download postponed. Reopen the game or tap Retry when ready.");
        final CountDownLatch decision=new CountDownLatch(1);final boolean[] accepted={false};downloadDecision=decision;
        runOnUiThread(()->{
            if(closed){decision.countDown();return;}
            working.setVisibility(View.GONE);downloadProgress.setVisibility(View.GONE);downloadSummary.setVisibility(View.GONE);
            status.setText("Game data is needed before you can play.");
            downloadDialog=new AlertDialog.Builder(this,android.R.style.Theme_Material_Light_Dialog_Alert)
                .setTitle("Download game data?")
                .setMessage("The complete first download is about "+size(totalDownloadBytes)+". Installed game data uses about "+size(expandedBytes)+".\n\nKeep at least 8 GB free for installation. Interrupted downloads can resume without starting over.")
                .setPositiveButton("Download",(dialog,which)->{accepted[0]=true;decision.countDown();})
                .setNegativeButton("Not now",(dialog,which)->decision.countDown())
                .setOnCancelListener(dialog->decision.countDown()).create();
            downloadDialog.setOnDismissListener(dialog->decision.countDown());downloadDialog.show();
        });
        try{decision.await();}
        catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException("Download postponed. Reopen the game or tap Retry when ready.",e);}
        finally{downloadDecision=null;}
        if(closed||!accepted[0])throw new IOException("Download postponed. Tap Retry when you are ready to download.");
        if(!approval.edit().putString("approvedManifestSha256",manifestHash).commit())throw new IOException("Cannot save download approval. Tap Retry to continue.");
        showNow("Resuming verified game-data download…");
    }
    private void begin(){
        if(starting||closed)return;starting=true;retry.setVisibility(View.GONE);downloadProgress.setVisibility(View.GONE);downloadSummary.setVisibility(View.GONE);working.setVisibility(View.VISIBLE);showNow("Preparing game data…");
        worker.submit(()->{
            try{
                if(!GcgServerService.isSupported())throw new IOException("GCG Offline requires Android 7 or newer and an ARM device");
                ReleaseBridge.getAccount(this);
                File pending=new File(ReleaseStore.root(this),"pending.gcgupdate");
                if(pending.isFile()){
                    show("Finishing approved app update…");File apk=ReleaseEngine.importUpdate(this,pending,false,this::show);
                    if(apk!=null){runOnUiThread(()->{startActivity(new Intent(this,UpdateActivity.class).putExtra("pending",true));finish();});return;}
                }
                ReleaseEngine.bootstrap(this,new BootProgress());
                runOnUiThread(()->{if(!closed){hideProgress();working.setVisibility(View.VISIBLE);}});showNow("Starting local game server…");
                if(!bound){Intent intent=new Intent(this,GcgServerService.class);bound=getApplicationContext().bindService(intent,CONNECTION,Context.BIND_AUTO_CREATE);if(!bound)throw new IOException("Cannot start local server");}
                long deadline=SystemClock.elapsedRealtime()+30000;
                while(SystemClock.elapsedRealtime()<deadline){if(isReady()){launch();return;}Thread.sleep(200);}
                throw new IOException("Local server did not become ready. Retry to continue.");
            }catch(Exception e){showNow(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());runOnUiThread(()->{if(!closed){starting=false;hideProgress();retry.setVisibility(View.VISIBLE);}});}
        });
    }
    private boolean isReady(){
        try{
            JSONObject health=json("/health"),list=json("/serverlist");JSONArray servers=list.getJSONArray("serverlist");
            String ownedPid=new String(ReleaseIO.read(new File(ServerPayload.root(this),"process-id"),32),java.nio.charset.StandardCharsets.US_ASCII);
            // A private test app may still own the same localhost ports. Never
            // accept its profile or health response as this application's server.
            return ownedPid.equals(Integer.toString(health.optInt("pid",-1)))&&health.optBoolean("ok")&&servers.length()==1&&servers.getJSONObject(0).getString("ip").equals("127.0.0.1")&&servers.getJSONObject(0).getJSONArray("port").length()==1&&servers.getJSONObject(0).getJSONArray("port").getInt(0)==31400;
        }catch(Exception e){return false;}
    }
    private static JSONObject json(String path)throws Exception{
        HttpURLConnection con=(HttpURLConnection)new URL("http://127.0.0.1:28080"+path).openConnection(Proxy.NO_PROXY);
        try{con.setConnectTimeout(500);con.setReadTimeout(500);con.setInstanceFollowRedirects(false);con.setUseCaches(false);if(con.getResponseCode()!=200)throw new IOException("Local health unavailable");try(InputStream in=con.getInputStream()){return new JSONObject(new String(ReleaseIO.read(in,32768),java.nio.charset.StandardCharsets.UTF_8));}}finally{con.disconnect();}
    }
    private void launch(){runOnUiThread(()->{
        if(closed||launched)return;launched=true;hideProgress();status.setText("Ready to play.");
        // Keep the exact Unity preference format while refusing any saved external route.
        getSharedPreferences(getPackageName()+".v2.playerprefs",MODE_PRIVATE).edit().putString("gcg.localServerUrl",android.net.Uri.encode("http://127.0.0.1:28080")).commit();
        Intent game=new Intent(getIntent());game.setClassName(this,"com.unity3d.player.UnityPlayerActivity");game.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);startActivity(game);finish();
    });}
    @Override public void onBackPressed(){finish();}
    @Override public void onDestroy(){closed=true;CountDownLatch decision=downloadDecision;if(decision!=null)decision.countDown();if(downloadDialog!=null)downloadDialog.dismiss();worker.shutdownNow();super.onDestroy();}
}
