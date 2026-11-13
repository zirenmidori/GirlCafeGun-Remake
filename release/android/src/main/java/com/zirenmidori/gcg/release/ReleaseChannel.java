package com.zirenmidori.gcg.release;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.HashSet;
import java.util.Set;
import org.json.*;

/** Select a base-compatible artifact after its channel envelope is verified. */
public final class ReleaseChannel {
    private ReleaseChannel() {}
    public static final class Selection {
        public final String releaseId, url, sha256;
        public final long size;
        private Selection(String id,String url,long size,String hash){releaseId=id;this.url=url;this.size=size;sha256=hash;}
    }
    private static String string(JSONObject row,String key)throws IOException,JSONException{
        Object value=row.get(key);if(!(value instanceof String))throw new IOException("Invalid channel string: "+key);return (String)value;
    }
    private static Selection artifact(JSONObject row,String id)throws IOException,JSONException{
        String address=string(row,"url");
        try{
            URI uri=new URI(address);
            if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getFragment()!=null||uri.getPort()==0||uri.getPort()>65535)
                throw new IOException("Only HTTPS update URLs without credentials or fragments are supported");
        }catch(URISyntaxException invalid){throw new IOException("Invalid HTTPS update URL",invalid);}
        long size=ReleaseManifest.number(row,"size");
        if(size<=0||size>ReleaseEngine.MAX_IMPORT)throw new IOException("Online update exceeds supported size");
        return new Selection(id,address,size,ReleaseManifest.digest(string(row,"sha256")));
    }
    /** Returns null only when the committed release already equals the channel. */
    public static Selection select(JSONObject channel,String packageName,String currentRelease)throws IOException{
        try{
            if(ReleaseManifest.number(channel,"schemaVersion")!=1||!packageName.equals(string(channel,"packageName")))throw new IOException("Wrong online update channel");
            String id=ReleaseManifest.identifier(string(channel,"releaseId"));
            String current=currentRelease==null?null:ReleaseManifest.identifier(currentRelease);
            boolean anyPrimary=channel.has("url")||channel.has("size")||channel.has("sha256");
            Selection primary=anyPrimary?artifact(channel,id):null;
            String primaryBase=channel.has("baseReleaseId")?ReleaseManifest.identifier(string(channel,"baseReleaseId")):null;
            if(primaryBase!=null&&(primary==null||primaryBase.equals(id)))throw new IOException("Channel base requires a distinct update artifact");
            Selection chosen=null;
            if(channel.has("routes")){
                if(primary==null)throw new IOException("Routed channel must retain its legacy artifact");
                JSONArray routes=channel.getJSONArray("routes");
                if(routes.length()==0||routes.length()>64)throw new IOException("Invalid channel route count");
                Set<String> bases=new HashSet<>();
                for(int i=0;i<routes.length();i++){
                    JSONObject row=routes.getJSONObject(i);String base=ReleaseManifest.identifier(string(row,"baseReleaseId"));
                    if(!bases.add(base)||base.equals(id))throw new IOException("Duplicate or self-referential channel route");
                    Selection route=artifact(row,id);
                    if(base.equals(primaryBase)&&(!route.url.equals(primary.url)||route.size!=primary.size||!route.sha256.equals(primary.sha256)))throw new IOException("Primary channel route disagrees with legacy artifact");
                    if(base.equals(current))chosen=route;
                }
                if(primaryBase!=null&&!bases.contains(primaryBase))throw new IOException("Primary channel route is missing");
            }else if(primaryBase==null||primaryBase.equals(current))chosen=primary;
            if(id.equals(current))return null;
            if(current==null)throw new IOException("Install the initial game data before checking for updates");
            if(chosen==null)throw new IOException("No published update is available for data release "+current+". Choose a compatible update file.");
            return chosen;
        }catch(JSONException invalid){throw new IOException("Invalid online update channel",invalid);}
    }
}
