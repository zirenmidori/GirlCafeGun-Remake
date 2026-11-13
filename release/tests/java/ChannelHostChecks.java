import com.zirenmidori.gcg.release.*;
import org.json.*;

/** Production channel selection tests; no Android UI or network substitution. */
final class ChannelHostChecks {
    static final String HASH="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    static JSONObject artifact(String suffix)throws Exception{return new JSONObject().put("url","https://downloads.example/"+suffix+".gcgupdate").put("size",123).put("sha256",HASH);}
    static JSONObject channel()throws Exception{
        JSONObject row=artifact("from-1");
        return row.put("schemaVersion",1).put("packageName",ReleaseManifest.APP_ID).put("releaseId","0.1.2");
    }
    static JSONObject routed()throws Exception{
        return channel().put("baseReleaseId","0.1.1").put("routes",new JSONArray()
            .put(artifact("from-0").put("baseReleaseId","0.1.0"))
            .put(artifact("from-1").put("baseReleaseId","0.1.1")));
    }
    static ReleaseChannel.Selection select(JSONObject row,String base)throws Exception{return ReleaseChannel.select(row,ReleaseManifest.APP_ID,base);}
    static void run()throws Exception{
        UpdaterHostTest.test("legacy channel and current-release marker remain compatible",()->{
            JSONObject c=channel();ReleaseChannel.Selection s=select(c,"0.1.1");
            UpdaterHostTest.yes(s.releaseId.equals("0.1.2")&&s.url.endsWith("from-1.gcgupdate")&&s.size==123&&s.sha256.equals(HASH),"legacy descriptor identity");
            c.remove("url");c.remove("size");c.remove("sha256");
            UpdaterHostTest.yes(select(c,"0.1.2")==null,"current marker needs no artifact");
            UpdaterHostTest.rejects(()->select(c,"0.1.1"));
        });
        UpdaterHostTest.test("signed-channel routes select exact committed data bases",()->{
            JSONObject c=routed();
            UpdaterHostTest.yes(select(c,"0.1.0").url.endsWith("from-0.gcgupdate"),"old base selects old-base delta");
            UpdaterHostTest.yes(select(c,"0.1.1").url.endsWith("from-1.gcgupdate"),"new base selects new-base delta");
            UpdaterHostTest.yes(select(c,"0.1.2")==null,"target release is latest");
            UpdaterHostTest.yes(c.getString("url").endsWith("from-1.gcgupdate"),"old clients retain primary artifact");
        });
        UpdaterHostTest.test("unknown and uninstalled data bases reject before download",()->{
            UpdaterHostTest.rejects(()->select(routed(),"custom.1"));
            UpdaterHostTest.rejects(()->select(routed(),null));
            UpdaterHostTest.rejects(()->select(channel().put("baseReleaseId","0.1.1"),"0.1.0"));
            UpdaterHostTest.rejects(()->ReleaseChannel.select(channel(),"wrong.package","0.1.1"));
            UpdaterHostTest.rejects(()->select(channel().put("schemaVersion",2),"0.1.1"));
        });
        UpdaterHostTest.test("duplicate missing and conflicting channel routes reject",()->{
            JSONObject duplicate=routed();duplicate.getJSONArray("routes").put(artifact("other").put("baseReleaseId","0.1.0"));UpdaterHostTest.rejects(()->select(duplicate,"0.1.1"));
            JSONObject conflict=routed();conflict.getJSONArray("routes").getJSONObject(1).put("size",124);UpdaterHostTest.rejects(()->select(conflict,"0.1.0"));
            JSONObject missing=routed();missing.put("routes",new JSONArray().put(artifact("from-0").put("baseReleaseId","0.1.0")));UpdaterHostTest.rejects(()->select(missing,"0.1.0"));
            UpdaterHostTest.rejects(()->select(channel().put("routes",new JSONArray()),"0.1.1"));
            UpdaterHostTest.rejects(()->select(channel().put("routes",JSONObject.NULL),"0.1.1"));
            JSONObject noPrimary=routed();noPrimary.remove("url");noPrimary.remove("size");noPrimary.remove("sha256");UpdaterHostTest.rejects(()->select(noPrimary,"0.1.0"));
        });
        UpdaterHostTest.test("all route URLs hashes and exact sizes validate before selection",()->{
            for(String url:new String[]{"http://downloads.example/file","https://user:secret@downloads.example/file","https://downloads.example/file#part","https://downloads.example:0/file","https://downloads.example:65536/file","https://bad host/file"}){
                JSONObject c=routed();c.getJSONArray("routes").getJSONObject(0).put("url",url);UpdaterHostTest.rejects(()->select(c,"0.1.1"));
            }
            for(Object size:new Object[]{0,-1,ReleaseEngine.MAX_IMPORT+1,1.5,true,"123"}){
                JSONObject c=routed();c.getJSONArray("routes").getJSONObject(0).put("size",size);UpdaterHostTest.rejects(()->select(c,"0.1.1"));
            }
            JSONObject c=routed();c.getJSONArray("routes").getJSONObject(0).put("sha256","bad");UpdaterHostTest.rejects(()->select(c,"0.1.1"));
            JSONObject query=channel().put("url","https://downloads.example:443/file?download=1");UpdaterHostTest.yes(select(query,"0.1.1").url.endsWith("?download=1"),"valid HTTPS query retained");
        });
    }
}
