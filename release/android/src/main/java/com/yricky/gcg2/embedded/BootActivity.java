package com.yricky.gcg2.embedded;

import android.app.Activity;
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
    private TextView status;private Button retry;private boolean launched,closed;
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
        status=new TextView(this);status.setText("Preparing GCG Offline…");status.setTextSize(20);view.addView(status);
        view.addView(new ProgressBar(this));retry=new Button(this);retry.setText("Retry");retry.setVisibility(View.GONE);retry.setOnClickListener(v->begin());view.addView(retry);setContentView(view);begin();
    }
    private void show(String text){runOnUiThread(()->{if(!closed)status.setText(text);});}
    private void begin(){
        retry.setVisibility(View.GONE);
        worker.submit(()->{
            try{
                if(!GcgServerService.isSupported())throw new IOException("GCG Offline requires Android 7 or newer and an ARM device");
                ReleaseBridge.getAccount(this);
                File pending=new File(ReleaseStore.root(this),"pending.gcgupdate");
                if(pending.isFile()){
                    show("Finishing approved app update…");File apk=ReleaseEngine.importUpdate(this,pending,false,this::show);
                    if(apk!=null){runOnUiThread(()->{startActivity(new Intent(this,UpdateActivity.class).putExtra("pending",true));finish();});return;}
                }
                ReleaseEngine.bootstrap(this,this::show);show("Starting local game server…");
                if(!bound){Intent intent=new Intent(this,GcgServerService.class);bound=getApplicationContext().bindService(intent,CONNECTION,Context.BIND_AUTO_CREATE);if(!bound)throw new IOException("Cannot start local server");}
                long deadline=SystemClock.elapsedRealtime()+30000;
                while(SystemClock.elapsedRealtime()<deadline){if(isReady()){launch();return;}Thread.sleep(200);}
                throw new IOException("Local server did not become ready. Retry to continue.");
            }catch(Exception e){show(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());runOnUiThread(()->{if(!closed)retry.setVisibility(View.VISIBLE);});}
        });
    }
    private static boolean isReady(){
        try{
            JSONObject health=json("/health"),list=json("/serverlist");JSONArray servers=list.getJSONArray("serverlist");
            return health.optBoolean("ok")&&servers.length()==1&&servers.getJSONObject(0).getString("ip").equals("127.0.0.1")&&servers.getJSONObject(0).getJSONArray("port").length()==1&&servers.getJSONObject(0).getJSONArray("port").getInt(0)==31400;
        }catch(Exception e){return false;}
    }
    private static JSONObject json(String path)throws Exception{
        HttpURLConnection con=(HttpURLConnection)new URL("http://127.0.0.1:28080"+path).openConnection(Proxy.NO_PROXY);
        try{con.setConnectTimeout(500);con.setReadTimeout(500);con.setInstanceFollowRedirects(false);con.setUseCaches(false);if(con.getResponseCode()!=200)throw new IOException("Local health unavailable");try(InputStream in=con.getInputStream()){return new JSONObject(new String(ReleaseIO.read(in,32768),java.nio.charset.StandardCharsets.UTF_8));}}finally{con.disconnect();}
    }
    private void launch(){runOnUiThread(()->{
        if(closed||launched)return;launched=true;
        // Keep the exact Unity preference format while refusing any saved external route.
        getSharedPreferences(getPackageName()+".v2.playerprefs",MODE_PRIVATE).edit().putString("gcg.localServerUrl",android.net.Uri.encode("http://127.0.0.1:28080")).commit();
        Intent game=new Intent(getIntent());game.setClassName(this,"com.unity3d.player.UnityPlayerActivity");game.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);startActivity(game);finish();
    });}
    @Override public void onBackPressed(){finish();}
    @Override public void onDestroy(){closed=true;worker.shutdownNow();super.onDestroy();}
}
