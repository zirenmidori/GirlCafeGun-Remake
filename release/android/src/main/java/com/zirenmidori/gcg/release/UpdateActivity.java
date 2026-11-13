package com.zirenmidori.gcg.release;

import android.app.*;
import android.content.*;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.util.Base64;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

/** User-initiated updater, isolated from the Unity and Node processes. */
public final class UpdateActivity extends Activity {
    private static final int PICK=100,INSTALL_PERMISSION=101;
    private static final String CHANNEL="https://raw.githubusercontent.com/zirenmidori/GirlCafeGun-Offline/main/channel.json";
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private TextView status;private LinearLayout actions;private boolean busy,closed;private File waitingApk;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinearLayout layout=new LinearLayout(this);layout.setPadding(40,24,40,24);layout.setGravity(Gravity.CENTER);layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(android.graphics.Color.rgb(22,26,39));
        status=new TextView(this);status.setTextSize(18);status.setText("GCG Offline updates");layout.addView(status);actions=new LinearLayout(this);actions.setOrientation(LinearLayout.VERTICAL);layout.addView(actions);setContentView(layout);
        status.setTextColor(android.graphics.Color.WHITE);status.setGravity(Gravity.CENTER);
        button("Check online",()->checkOnline());button("Updates in game folder",()->scan());button("Choose update file",()->pick());button("Return to game",()->returnToGame());
        int pid=getIntent().getIntExtra("gamePid",0);if(pid>0&&pid!=android.os.Process.myPid()){
            ActivityManager manager=(ActivityManager)getSystemService(ACTIVITY_SERVICE);List<ActivityManager.RunningAppProcessInfo> processes=manager.getRunningAppProcesses();
            if(processes!=null)for(ActivityManager.RunningAppProcessInfo p:processes)if(p.pid==pid&&p.uid==android.os.Process.myUid()&&p.processName.equals(getPackageName()))android.os.Process.killProcess(pid);
        }
        int installStatus=getIntent().getIntExtra("installerStatus",Integer.MIN_VALUE);
        if(installStatus!=Integer.MIN_VALUE&&installStatus!=PackageInstaller.STATUS_SUCCESS)show("App update was not installed. Your data and profile were preserved.");
        else if(getIntent().getBooleanExtra("pending",false)||installStatus==PackageInstaller.STATUS_SUCCESS)submit(()->{File pending=new File(ReleaseStore.root(this),"pending.gcgupdate");if(pending.isFile())process(pending,false);});
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);int s=intent.getIntExtra("installerStatus",Integer.MIN_VALUE);if(s==PackageInstaller.STATUS_SUCCESS)submit(()->{File f=new File(ReleaseStore.root(this),"pending.gcgupdate");if(f.isFile())process(f,false);});else if(s!=Integer.MIN_VALUE)show("App installation was cancelled or failed. Current data and profile were preserved.");}
    private void button(String text,Runnable task){Button b=new Button(this);b.setText(text);b.setOnClickListener(v->task.run());actions.addView(b);}
    private void show(String text){runOnUiThread(()->{if(!closed)status.setText(text);});}
    private void setBusy(boolean value){busy=value;runOnUiThread(()->{for(int i=0;i<actions.getChildCount();i++)actions.getChildAt(i).setEnabled(!value);});}
    private interface Job{void run()throws Exception;}
    private void submit(Job task){if(busy)return;setBusy(true);worker.submit(()->{try{waitForServerStop();task.run();}catch(Exception e){show(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());}finally{setBusy(false);}});}
    private void waitForServerStop()throws Exception{
        long until=SystemClock.elapsedRealtime()+15000;
        while(SystemClock.elapsedRealtime()<until){try(Socket socket=new Socket()){socket.connect(new InetSocketAddress("127.0.0.1",28080),250);}catch(IOException stopped){return;}Thread.sleep(200);}
        throw new IOException("Close the game completely before applying updates.");
    }
    private void scan(){
        try{
            File folder=ReleaseIO.dir(new File(ReleaseStore.external(this),"updates"));File[] files=folder.listFiles(f->f.isFile()&&f.getName().endsWith(".gcgupdate"));
            if(files==null||files.length==0){show("Place a .gcgupdate file in "+folder.getAbsolutePath()+", or choose it from Downloads.");return;}
            Arrays.sort(files,Comparator.comparing(File::getName));String[] names=new String[files.length];for(int i=0;i<files.length;i++)names[i]=files[i].getName();
            new AlertDialog.Builder(this).setTitle("Choose update").setItems(names,(d,i)->prepare(files[i])).setNegativeButton("Cancel",null).show();
        }catch(IOException e){show(e.getMessage());}
    }
    private void pick(){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/zip","application/octet-stream","application/x-zip-compressed"});startActivityForResult(intent,PICK);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
        if(request==PICK&&result==RESULT_OK&&data!=null&&data.getData()!=null){Uri uri=data.getData();submit(()->{File incoming=new File(ReleaseStore.root(this),"incoming.gcgupdate");show("Importing update file…");
            try(InputStream in=getContentResolver().openInputStream(uri);FileOutputStream out=new FileOutputStream(incoming)){if(in==null)throw new IOException("Selected file cannot be opened");byte[] buffer=new byte[131072];long total=0;int n;while((n=in.read(buffer))!=-1){total+=n;if(total>ReleaseEngine.MAX_IMPORT)throw new IOException("Update package is too large");out.write(buffer,0,n);}out.getFD().sync();}
            inspectForConsent(incoming);
        });}
        else if(request==INSTALL_PERMISSION&&waitingApk!=null){File apk=waitingApk;waitingApk=null;if(Build.VERSION.SDK_INT>=26&&!getPackageManager().canRequestPackageInstalls()){cancelPending();show("App update was cancelled. Your current game is ready to use.");}else submit(()->requestInstall(apk));}
    }
    private void prepare(File source){submit(()->{
        if(source.length()>ReleaseEngine.MAX_IMPORT)throw new IOException("Update package is too large");
        File incoming=new File(ReleaseStore.root(this),"incoming.gcgupdate");if(!source.equals(incoming))ReleaseIO.copy(source,incoming,source.length(),ReleaseIO.sha(source));inspectForConsent(incoming);
    });}
    private void inspectForConsent(File source)throws Exception{
        byte[] publisher=ReleaseEngine.publisher(source);boolean foreign=publisher!=null&&!Arrays.equals(publisher,ReleaseManifest.publicKey(this));
        ReleaseManifest m=ReleaseEngine.inspect(this,source,foreign);
        JSONObject current=ReleaseStore.state(this);if(current==null||!m.json.optString("baseReleaseId").equals(current.optString("releaseId")))throw new IOException("This update needs a different base data release");
        String fingerprint=publisher==null?"":ReleaseIO.hex(ReleaseIO.digest().digest(publisher));
        runOnUiThread(()->new AlertDialog.Builder(this).setTitle(foreign?"Trust this data publisher once?":"Apply update "+m.releaseId+"?")
            .setMessage(foreign?"This local data update uses a different publisher key. Trust it only if you recognize this SHA-256 fingerprint:\n\n"+fingerprint+"\n\nThis choice applies to this import only.":"Verified publisher signature. Your existing local profile will be preserved.")
            .setPositiveButton(foreign?"Trust once and apply":"Apply",(d,w)->submit(()->process(source,foreign))).setNegativeButton("Cancel",null).show());
    }
    private void process(File source,boolean trustOnce)throws Exception{
        File apk=ReleaseEngine.importUpdate(this,source,trustOnce,this::show);
        if(apk!=null){show("The app update is verified. Android will ask you to approve installation.");requestInstall(apk);}
        else show("Update completed. Return to the game when ready.");
    }
    private void requestInstall(File apk)throws IOException{
        if(Build.VERSION.SDK_INT>=26&&!getPackageManager().canRequestPackageInstalls()){
            waitingApk=apk;runOnUiThread(()->new AlertDialog.Builder(this).setTitle("Allow this app to request its update")
                .setMessage("Android needs your approval for GCG Offline to open the package installer.")
                .setPositiveButton("Open Android settings",(d,w)->startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())),INSTALL_PERMISSION)).setNegativeButton("Cancel",(d,w)->{waitingApk=null;cancelPending();}).show());return;
        }
        ApkDelta.install(this,apk);
    }
    private void checkOnline(){submit(()->{
        show("Checking for updates…");byte[] raw=getHttps(CHANNEL,2L*1024*1024);JSONObject envelope=new JSONObject(new String(raw,java.nio.charset.StandardCharsets.UTF_8));
        byte[] payload=Base64.decode(envelope.getString("payload"),Base64.DEFAULT),signature=Base64.decode(envelope.getString("signature"),Base64.DEFAULT);
        Signature check=Signature.getInstance("SHA256withRSA");check.initVerify(KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(ReleaseManifest.publicKey(this))));check.update(payload);if(!check.verify(signature))throw new IOException("Online channel signature is invalid");
        JSONObject next=new JSONObject(new String(payload,java.nio.charset.StandardCharsets.UTF_8));if(ReleaseManifest.number(next,"schemaVersion")!=1||!getPackageName().equals(next.getString("packageName")))throw new IOException("Wrong online update channel");
        String id=ReleaseManifest.identifier(next.getString("releaseId"));JSONObject current=ReleaseStore.state(this);if(current!=null&&id.equals(current.optString("releaseId"))){show("You have the latest published release.");return;}
        long size=ReleaseManifest.number(next,"size");if(size>ReleaseEngine.MAX_IMPORT)throw new IOException("Online update exceeds supported size");String hash=ReleaseManifest.digest(next.getString("sha256"));
        File dir=ReleaseIO.dir(new File(ReleaseStore.root(this),"online"));File update=ReleaseDownload.fetch(dir,"update-"+id,next.getString("url"),size,hash,this::show);
        // No foreign key can be accepted by the online path, even with a valid channel envelope.
        byte[] publisher=ReleaseEngine.publisher(update);if(publisher!=null&&!Arrays.equals(publisher,ReleaseManifest.publicKey(this)))throw new IOException("Online updates must use the embedded publisher key");
        inspectForConsent(update);
    });}
    private static byte[] getHttps(String address,long limit)throws IOException{
        for(int redirects=0;redirects<5;redirects++){
            URL url=new URL(address);if(!url.getProtocol().equals("https")||url.getUserInfo()!=null)throw new IOException("Only public HTTPS updates are supported");
            HttpsURLConnection con=(HttpsURLConnection)url.openConnection(Proxy.NO_PROXY);con.setConnectTimeout(15000);con.setReadTimeout(15000);con.setInstanceFollowRedirects(false);
            try{int code=con.getResponseCode();if(code>=300&&code<400){address=new URL(url,con.getHeaderField("Location")).toString();continue;}if(code!=200)throw new IOException("Update channel returned HTTP "+code);try(InputStream in=con.getInputStream()){return ReleaseIO.read(in,limit);}}finally{con.disconnect();}
        }
        throw new IOException("Too many update channel redirects");
    }
    private void cancelPending(){try{new File(ReleaseStore.root(this),"pending.gcgupdate").delete();new File(ReleaseStore.root(this),"candidate.apk").delete();}catch(IOException e){show(e.getMessage());}}
    private void returnToGame(){if(busy)return;try{File pending=new File(ReleaseStore.root(this),"pending.gcgupdate");if(pending.isFile()){JSONObject apk=ReleaseEngine.inspect(this,pending,false).json.optJSONObject("apk");if(apk!=null&&!ApkDelta.alreadyInstalled(this,apk))cancelPending();}}catch(IOException e){show(e.getMessage());return;}Intent boot=new Intent();boot.setClassName(this,"com.yricky.gcg2.embedded.BootActivity");boot.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);startActivity(boot);finish();}
    @Override public void onBackPressed(){if(!busy)returnToGame();}
    @Override public void onDestroy(){closed=true;worker.shutdownNow();super.onDestroy();}
}
