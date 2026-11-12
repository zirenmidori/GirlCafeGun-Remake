package com.zirenmidori.gcg.release;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.util.*;

public final class ReleaseStore {
    private ReleaseStore() {}
    public static final class Lock implements Closeable {
        private final RandomAccessFile file;private final java.nio.channels.FileLock lock;
        private Lock(Context c)throws IOException{file=new RandomAccessFile(new File(root(c),"transaction.lock"),"rw");lock=file.getChannel().lock();}
        @Override public void close()throws IOException{try{lock.release();}finally{file.close();}}
    }
    public static Lock lock(Context c)throws IOException{return new Lock(c);}
    public static File root(Context c) throws IOException { return ReleaseIO.dir(new File(c.getFilesDir(), "release")); }
    public static File external(Context c) throws IOException {
        File dir = c.getExternalFilesDir(null); if (dir == null) throw new IOException("Game storage is unavailable");
        return ReleaseIO.dir(dir);
    }
    public static JSONObject readJson(File file) throws IOException {
        try { return new JSONObject(new String(ReleaseIO.read(file,16L*1024*1024),java.nio.charset.StandardCharsets.UTF_8)); }
        catch (JSONException e) { throw new IOException("Invalid transaction state", e); }
    }
    public static void writeJson(File file, JSONObject value) throws IOException { ReleaseIO.atomic(file, ReleaseIO.utf8(value.toString())); }
    public static JSONObject state(Context c) throws IOException {
        File file = new File(root(c), "committed.json"); return file.isFile() ? readJson(file) : null;
    }
    public static boolean ready(Context c) throws IOException { return state(c) != null; }
    public static void adoptVerifiedFull(Context c,ReleaseManifest manifest)throws IOException{
        if(!manifest.kind.equals("full")||state(c)!=null)throw new IOException("Only a fresh complete data installation can be adopted");
        try{writeJson(new File(root(c),"committed.json"),new JSONObject().put("schemaVersion",1).put("releaseId",manifest.releaseId).put("manifestSha256",manifest.hash));}
        catch(JSONException e){throw new IOException(e);}
    }
    public static File activeServer(Context c) throws IOException {
        JSONObject state = state(c); if (state == null) return null;
        String hash = state.optString("serverPayloadSha256", ""); if (hash.isEmpty()) return null;
        ReleaseManifest.digest(hash);
        File root = ReleaseIO.dir(new File(c.getFilesDir(), "gcg-server"));
        File version = ReleaseIO.child(ReleaseIO.dir(new File(root,"payloads")), hash);
        File marker = new File(version,".payload-ready");
        if (!version.isDirectory() || !marker.isFile() || !new String(ReleaseIO.read(marker,64),java.nio.charset.StandardCharsets.US_ASCII).equals(hash))
            throw new IOException("Committed server payload is missing");
        return version;
    }
    public static void recover(Context c) throws IOException {
        File journal = new File(root(c),"journal.json"); if (!journal.isFile()) return;
        JSONObject j = readJson(journal);
        if ("committed".equals(j.optString("status"))) { cleanup(c,j); return; }
        rollback(c,j);
    }
    private static File transaction(Context c, JSONObject j) throws IOException {
        String id = j.optString("id");
        if (!id.matches("[0-9a-f-]{36}")) throw new IOException("Invalid transaction directory");
        return ReleaseIO.child(external(c),".gcg-release-"+id);
    }
    private static void cleanup(Context c, JSONObject j) throws IOException {
        File stage=transaction(c,j); if(stage.exists()) ReleaseIO.deleteTree(stage);
        File journal=new File(root(c),"journal.json"); if(journal.exists()&&!journal.delete()) throw new IOException("Cannot finish transaction cleanup");
    }
    private static void rollback(Context c, JSONObject j) throws IOException {
        try {
            File stage=transaction(c,j), destination=external(c); JSONArray planned=j.getJSONArray("planned");
            JSONObject before=j.getJSONObject("before");
            for(int i=planned.length()-1;i>=0;i--){
                String name=ReleaseManifest.resource(planned.getString(i)); JSONObject old=before.getJSONObject(name);
                File target=ReleaseIO.child(destination,name);
                if(old.getBoolean("present")){
                    File backup=ReleaseIO.child(stage,"backup/"+name);
                    long size=ReleaseManifest.number(old,"size");String hash=old.getString("sha256");
                    if(!backup.isFile()||backup.length()!=size||!ReleaseIO.sha(backup).equals(hash)) throw new IOException("Rollback backup is incomplete: "+name);
                    File temp=ReleaseIO.child(stage,"restore/"+name);ReleaseIO.copy(backup,temp,size,hash);ReleaseIO.dir(target.getParentFile());
                    ReleaseIO.rename(temp,target);
                }else if(target.exists()&&!target.delete())throw new IOException("Cannot remove added resource: "+name);
            }
            File committed=new File(root(c),"committed.json");JSONObject oldState=j.optJSONObject("oldState");
            if(oldState!=null)writeJson(committed,oldState);else if(committed.exists()&&!committed.delete())throw new IOException("Cannot restore release marker");
            j.put("status","rolledBack");writeJson(new File(root(c),"journal.json"),j);cleanup(c,j);
        }catch(JSONException e){throw new IOException("Invalid rollback journal",e);}
    }
    public static File newStage(Context c) throws IOException { return ReleaseIO.dir(ReleaseIO.child(external(c),".gcg-release-"+UUID.randomUUID())); }
    public static void apply(Context c,ReleaseManifest manifest,File stage,String serverHash) throws IOException {
        File journal=new File(root(c),"journal.json");if(journal.exists())throw new IOException("A prior transaction needs recovery");
        JSONObject current=state(c);
        if(manifest.kind.equals("delta")&&(current==null||!manifest.json.optString("baseReleaseId").equals(current.optString("releaseId"))))throw new IOException("Update is for a different installed data release");
        try{
            List<String> names=new ArrayList<>();File destination=external(c);
            // Verified preplaced resources and unchanged delta entries are adopted in
            // place. They need neither a second full copy nor a transaction backup.
            for(String name:manifest.files.keySet()){
                JSONObject row=manifest.files.get(name);File target=ReleaseIO.child(destination,name);
                if(!target.isFile()||target.length()!=ReleaseManifest.number(row,"size")||!ReleaseIO.sha(target).equals(row.getString("sha256")))names.add(name);
            }
            names.addAll(manifest.remove);
            Collections.sort(names,(a,b)->a.equals("version.data")?1:b.equals("version.data")?-1:a.compareTo(b));
            JSONObject before=new JSONObject();
            for(String name:names){
                File target=ReleaseIO.child(destination,name);JSONObject row=new JSONObject().put("present",target.exists());
                if(target.exists()){
                    if(!target.isFile())throw new IOException("Resource target is not a regular file");
                    long size=target.length();String hash=ReleaseIO.sha(target);row.put("size",size).put("sha256",hash);
                    ReleaseIO.copy(target,ReleaseIO.child(stage,"backup/"+name),size,hash);
                }
                before.put(name,row);
                JSONObject desired=manifest.files.get(name);
                if(desired!=null){File incoming=ReleaseIO.child(stage,"new/"+name);if(!incoming.isFile()||incoming.length()!=ReleaseManifest.number(desired,"size")||!ReleaseIO.sha(incoming).equals(desired.getString("sha256")))throw new IOException("Staged resource differs: "+name);}
            }
            String id=stage.getName().substring(".gcg-release-".length());
            JSONObject j=new JSONObject().put("schemaVersion",1).put("id",id).put("status","prepared").put("before",before).put("planned",new JSONArray()).put("oldState",current==null?JSONObject.NULL:current);
            writeJson(journal,j);
            try{
                for(String name:names){
                    j.getJSONArray("planned").put(name);j.put("status","applying");writeJson(journal,j);
                    File target=ReleaseIO.child(destination,name);JSONObject desired=manifest.files.get(name);
                    if(desired==null){if(target.exists()&&!target.delete())throw new IOException("Cannot delete resource: "+name);}
                    else{ReleaseIO.dir(target.getParentFile());ReleaseIO.rename(ReleaseIO.child(stage,"new/"+name),target);}
                }
                for(String name:names){File target=ReleaseIO.child(destination,name);JSONObject desired=manifest.files.get(name);if(desired==null?target.exists():!target.isFile()||target.length()!=ReleaseManifest.number(desired,"size")||!ReleaseIO.sha(target).equals(desired.getString("sha256")))throw new IOException("Published resource differs: "+name);}
                JSONObject next=new JSONObject().put("schemaVersion",1).put("releaseId",manifest.releaseId).put("manifestSha256",manifest.hash);
                if(serverHash!=null&&!serverHash.isEmpty())next.put("serverPayloadSha256",serverHash);
                else if(current!=null&&current.has("serverPayloadSha256"))next.put("serverPayloadSha256",current.getString("serverPayloadSha256"));
                writeJson(new File(root(c),"committed.json"),next);j.put("status","committed");writeJson(journal,j);
            }catch(IOException|JSONException e){rollback(c,j);if(e instanceof IOException)throw(IOException)e;throw new IOException(e);}
            cleanup(c,j);
        }catch(JSONException e){throw new IOException("Cannot create resource transaction",e);}
    }
}
