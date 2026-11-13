package com.zirenmidori.gcg.release;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.zip.*;

public final class ReleaseEngine {
    public static final long MAX_IMPORT=8L*1024*1024*1024;
    private ReleaseEngine(){}
    public static byte[] entry(ZipFile zip,String name,long max)throws IOException{
        ZipEntry e=zip.getEntry(name);if(e==null||e.isDirectory()||e.getSize()<0||e.getSize()>max)throw new IOException("Missing or excessive update entry: "+name);
        try(InputStream in=zip.getInputStream(e)){return ReleaseIO.read(in,max);}
    }
    public static byte[] publisher(File source)throws IOException{
        try(ZipFile zip=new ZipFile(source)){return zip.getEntry("publisher.der")==null?null:entry(zip,"publisher.der",8192);}
    }
    public static ReleaseManifest inspect(Context c,File source,boolean trustOnce)throws IOException{
        try(ZipFile zip=new ZipFile(source)){return ReleaseManifest.verify(c,entry(zip,"manifest.json",16L*1024*1024),entry(zip,"manifest.sig",8192),zip.getEntry("publisher.der")==null?null:entry(zip,"publisher.der",8192),trustOnce);}
    }
    private static boolean matches(File file,JSONObject row)throws IOException{
        return file.isFile()&&file.length()==ReleaseManifest.number(row,"size")&&ReleaseIO.sha(file).equals(row.optString("sha256"));
    }
    public static void bootstrap(Context c,ReleaseDownload.Progress progress)throws IOException{
        try(ReleaseStore.Lock ignored=ReleaseStore.lock(c)){bootstrapLocked(c,progress);}
    }
    private static void bootstrapLocked(Context c,ReleaseDownload.Progress progress)throws IOException{
        ReleaseStore.recover(c);
        if(ReleaseStore.ready(c))return;
        ReleaseManifest m=ReleaseManifest.bundled(c);
        if(!m.kind.equals("full")||ApkDelta.installedVersion(c)<ReleaseManifest.number(m.json,"minApkVersionCode"))throw new IOException("Bundled data release is incompatible with this app");
        Set<String> adopted=new HashSet<>();
        for(Map.Entry<String,JSONObject> file:m.files.entrySet()){
            progress.show("Checking existing data: "+file.getKey());
            if(matches(ReleaseIO.child(ReleaseStore.external(c),file.getKey()),file.getValue()))adopted.add(file.getKey());
        }
        if(adopted.size()==m.files.size()){
            ReleaseStore.adoptVerifiedFull(c,m);progress.show("Existing game data verified. Ready to play.");return;
        }
        File pointer=new File(ReleaseStore.root(c),"bootstrap-stage.json"),stage=null;
        if(pointer.isFile()){
            JSONObject p=ReleaseStore.readJson(pointer);String id=p.optString("id");
            if(m.hash.equals(p.optString("manifestSha256"))&&id.matches("[0-9a-f-]{36}"))stage=ReleaseIO.dir(ReleaseIO.child(ReleaseStore.external(c),".gcg-release-"+id));
        }
        if(stage==null){stage=ReleaseStore.newStage(c);try{ReleaseStore.writeJson(pointer,new JSONObject().put("id",stage.getName().substring(13)).put("manifestSha256",m.hash));}catch(JSONException e){throw new IOException(e);}}
        File downloads=ReleaseIO.dir(ReleaseIO.child(ReleaseStore.external(c),".gcg-downloads/"+m.hash));
        long totalDownload=0,expanded=0,complete=0;
        for(JSONObject p:m.packs.values())totalDownload+=ReleaseManifest.number(p,"size");
        for(JSONObject row:m.files.values())expanded+=ReleaseManifest.number(row,"size");
        final long overallTotal=totalDownload;
        boolean approved=false;
        for(Map.Entry<String,JSONObject> pack:m.packs.entrySet()){
            JSONObject p=pack.getValue();long packBytes=ReleaseManifest.number(p,"size");
            boolean done=true;for(Map.Entry<String,JSONObject> file:m.files.entrySet())if(pack.getKey().equals(file.getValue().optString("pack"))&&!adopted.contains(file.getKey())&&!matches(ReleaseIO.child(stage,"new/"+file.getKey()),file.getValue())){done=false;break;}
            if(done){complete+=packBytes;ReleaseDownload.bytes(progress,complete,overallTotal);continue;}
            if(!approved){ReleaseDownload.confirm(progress,totalDownload,expanded);approved=true;}
            final long verifiedBefore=complete;
            ReleaseDownload.Progress packProgress=new ReleaseDownload.DetailedProgress(){
                @Override public void show(String text){progress.show(text);}
                @Override public void bytes(long received,long size){ReleaseDownload.bytes(progress,verifiedBefore+received,overallTotal);}
                @Override public void confirmInitialDownload(long total,long expanded){}
            };
            File archive=ReleaseDownload.fetch(downloads,pack.getKey(),p.optString("url"),packBytes,p.optString("sha256"),packProgress);
            extractPack(archive,m,pack.getKey(),stage,adopted,progress);if(!archive.delete())throw new IOException("Cannot release verified pack storage");
            complete+=packBytes;ReleaseDownload.bytes(progress,complete,overallTotal);
        }
        progress.show("Verifying and committing game data…");ReleaseStore.apply(c,m,stage,null);pointer.delete();
    }
    private static void extractPack(File archive,ReleaseManifest manifest,String id,File stage,Set<String> adopted,ReleaseDownload.Progress progress)throws IOException{
        Set<String> expected=new HashSet<>();for(Map.Entry<String,JSONObject> e:manifest.files.entrySet())if(id.equals(e.getValue().optString("pack")))expected.add(e.getKey());
        Set<String> seen=new HashSet<>();
        try(ZipFile zip=new ZipFile(archive)){
            Enumeration<? extends ZipEntry> entries=zip.entries();
            while(entries.hasMoreElements()){
                ZipEntry e=entries.nextElement();String name=e.getName();ReleaseIO.path(e.isDirectory()?name.substring(0,name.length()-1):name);
                if(!seen.add(name))throw new IOException("Duplicate pack entry");if(e.isDirectory())continue;
                if(!expected.remove(name))throw new IOException("Undeclared pack entry: "+name);JSONObject row=manifest.files.get(name);
                if(e.getSize()!=ReleaseManifest.number(row,"size"))throw new IOException("Pack size differs: "+name);
                if(adopted.contains(name))continue;
                File out=ReleaseIO.child(stage,"new/"+name);progress.show("Preparing "+name);
                try(InputStream in=zip.getInputStream(e)){ReleaseIO.copy(in,out,ReleaseManifest.number(row,"size"),row.optString("sha256"));}
            }
        }
        if(!expected.isEmpty())throw new IOException("Pack is missing declared resources");
    }
    private static void validateManualMembers(ZipFile zip,ReleaseManifest m)throws IOException{
        Set<String> allowed=new HashSet<>(Arrays.asList("manifest.json","manifest.sig","publisher.der"));
        for(String name:m.files.keySet())allowed.add("files/"+name);
        if(m.json.optJSONObject("serverPayload")!=null)allowed.add("server/payload.zip");
        JSONObject apk=m.json.optJSONObject("apk");
        if(apk!=null){JSONArray ops=apk.optJSONArray("ops");if(ops==null)throw new IOException("APK operations missing");for(int i=0;i<ops.length();i++){JSONObject op=ops.optJSONObject(i);if(op==null)throw new IOException("Invalid APK operation");if("literal".equals(op.optString("kind")))allowed.add(ReleaseIO.path(op.optString("entry")));}}
        Set<String> seen=new HashSet<>();Enumeration<? extends ZipEntry> entries=zip.entries();int count=0;
        while(entries.hasMoreElements()){
            ZipEntry e=entries.nextElement();String name=e.getName();ReleaseIO.path(e.isDirectory()?name.substring(0,name.length()-1):name);
            if(!seen.add(name)||++count>200000)throw new IOException("Duplicate or excessive manual update entries");
            if(!e.isDirectory()&&!allowed.contains(name))throw new IOException("Undeclared manual update entry: "+name);
        }
        if(!seen.contains("manifest.json")||!seen.contains("manifest.sig"))throw new IOException("Unsigned update");
    }
    /** Returns a reconstructed APK when Android approval is needed; null means data committed. */
    public static File importUpdate(Context c,File source,boolean trustOnce,ReleaseDownload.Progress progress)throws IOException{
        try(ReleaseStore.Lock ignored=ReleaseStore.lock(c)){return importLocked(c,source,trustOnce,progress);}
    }
    private static File importLocked(Context c,File source,boolean trustOnce,ReleaseDownload.Progress progress)throws IOException{
        ReleaseStore.recover(c);ReleaseManifest m=inspect(c,source,trustOnce);
        if(!m.kind.equals("delta")||!m.packs.isEmpty())throw new IOException("Manual imports must be offline delta packages");
        JSONObject current=ReleaseStore.state(c);if(current==null||!m.json.optString("baseReleaseId").equals(current.optString("releaseId")))throw new IOException("Update base does not match this data release");
        try(ZipFile zip=new ZipFile(source)){
            validateManualMembers(zip,m);JSONObject apk=m.json.optJSONObject("apk");
            if(apk!=null&&!ApkDelta.alreadyInstalled(c,apk)){
                File candidate=ApkDelta.reconstruct(c,zip,apk,progress);
                File pending=new File(ReleaseStore.root(c),"pending.gcgupdate");if(!source.equals(pending))ReleaseIO.copy(source,pending,source.length(),ReleaseIO.sha(source));
                // Foreign publishers cannot enter this branch; APK updates use only the embedded release key.
                return candidate;
            }
            if(ApkDelta.installedVersion(c)<ReleaseManifest.number(m.json,"minApkVersionCode"))throw new IOException("Update needs a newer app APK");
            File stage=ReleaseStore.newStage(c);boolean applied=false;
            try{
                for(Map.Entry<String,JSONObject> file:m.files.entrySet()){
                    String name=file.getKey();JSONObject row=file.getValue();ZipEntry entry=zip.getEntry("files/"+name);
                    if(entry==null||entry.isDirectory()||entry.getSize()!=ReleaseManifest.number(row,"size"))throw new IOException("Missing update resource: "+name);
                    progress.show("Preparing "+name);try(InputStream in=zip.getInputStream(entry)){ReleaseIO.copy(in,ReleaseIO.child(stage,"new/"+name),ReleaseManifest.number(row,"size"),row.optString("sha256"));}
                }
                String serverHash=null;JSONObject server=m.json.optJSONObject("serverPayload");
                if(server!=null){File payload=ReleaseIO.child(stage,"server/payload.zip");ZipEntry e=zip.getEntry("server/payload.zip");if(e==null)throw new IOException("Server payload missing");try(InputStream in=zip.getInputStream(e)){ReleaseIO.copy(in,payload,ReleaseManifest.number(server,"size"),server.optString("sha256"));}serverHash=stageServer(c,payload,server);}
                progress.show("Committing update…");ReleaseStore.apply(c,m,stage,serverHash);applied=true;
                File pending=new File(ReleaseStore.root(c),"pending.gcgupdate");if(pending.exists())pending.delete();return null;
            }finally{if(!applied&&!new File(ReleaseStore.root(c),"journal.json").exists()&&stage.exists())ReleaseIO.deleteTree(stage);}
        }
    }
    private static String stageServer(Context c,File payload,JSONObject spec)throws IOException{
        String hash=ReleaseManifest.digest(spec.optString("sha256"));File versions=ReleaseIO.dir(new File(c.getFilesDir(),"gcg-server/payloads")),target=ReleaseIO.child(versions,hash);
        if(target.isDirectory()&&new File(target,".payload-ready").isFile())return hash;
        File stage=ReleaseIO.dir(ReleaseIO.child(versions,".update-"+UUID.randomUUID()));boolean published=false;
        try(ZipFile zip=new ZipFile(payload)){
            Set<String> seen=new HashSet<>();long total=0;Enumeration<? extends ZipEntry> rows=zip.entries();
            while(rows.hasMoreElements()){
                ZipEntry e=rows.nextElement();String name=e.getName();ReleaseIO.path(e.isDirectory()?name.substring(0,name.length()-1):name);
                if(!seen.add(name)||seen.size()>10000)throw new IOException("Duplicate/excessive server payload");if(e.isDirectory())continue;
                if(!(name.equals("bootstrap.mjs")||name.equals("package.json")||name.equals("LICENSE")||name.startsWith("LICENSES/")||name.equals("config/default.json")||name.startsWith("dist/")||name.startsWith("resources/")||name.startsWith("node_modules/"))||name.toLowerCase(Locale.ROOT).contains("state.json")||name.contains("/data/")||name.contains("/logs/"))throw new IOException("Server payload contains protected or undeclared path");
                if(e.getSize()<0||(total+=e.getSize())>ReleaseManifest.number(spec,"expandedSize"))throw new IOException("Server expansion exceeds declared size");
                File out=ReleaseIO.child(stage,name);ReleaseIO.dir(out.getParentFile());long size=0;
                try(InputStream in=zip.getInputStream(e);FileOutputStream stream=new FileOutputStream(out)){byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1){size+=n;if(size>e.getSize())throw new IOException("Server entry exceeds declared size");stream.write(buffer,0,n);}stream.getFD().sync();}
                if(size!=e.getSize())throw new IOException("Server entry truncated");
            }
            if(total!=ReleaseManifest.number(spec,"expandedSize")||seen.size()!=ReleaseManifest.number(spec,"entries"))throw new IOException("Server payload totals differ");
            for(String required:Arrays.asList("bootstrap.mjs","package.json","config/default.json","dist/index.js","node_modules/zod/package.json","resources/map/chapter.txt"))if(!new File(stage,required).isFile())throw new IOException("Incomplete server payload");
            ReleaseIO.atomic(new File(stage,".payload-ready"),ReleaseIO.utf8(hash));if(target.exists())throw new IOException("Conflicting immutable server payload");if(!stage.renameTo(target))throw new IOException("Cannot stage server payload");published=true;return hash;
        }finally{if(!published&&stage.exists())ReleaseIO.deleteTree(stage);}
    }
}
