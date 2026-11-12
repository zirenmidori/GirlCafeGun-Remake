package com.zirenmidori.gcg.release;

import java.io.*;
import java.net.*;
import javax.net.ssl.HttpsURLConnection;

public final class ReleaseDownload {
    public interface Progress { void show(String text); }
    private ReleaseDownload(){}
    public static File fetch(File dir,String id,String address,long size,String hash,Progress progress)throws IOException{
        File complete=ReleaseIO.child(dir,id+".zip"),part=ReleaseIO.child(dir,id+".part");
        if(complete.isFile()&&complete.length()==size&&ReleaseIO.sha(complete).equals(hash))return complete;
        if(complete.exists()&&!complete.delete())throw new IOException("Cannot replace incomplete download");
        if(part.exists()&&part.length()>size&&!part.delete())throw new IOException("Cannot reset download");
        IOException failure=null;
        for(int attempt=0;attempt<4;attempt++){
            HttpsURLConnection con=null;
            try{
                long offset=part.isFile()?part.length():0;
                if(offset==size){if(ReleaseIO.sha(part).equals(hash)){if(!part.renameTo(complete))throw new IOException("Cannot finish download");return complete;}part.delete();offset=0;}
                URL url=new URL(address);if(!url.getProtocol().equals("https")||url.getUserInfo()!=null)throw new IOException("Only public HTTPS pack URLs are supported");
                con=(HttpsURLConnection)url.openConnection(Proxy.NO_PROXY);con.setConnectTimeout(15000);con.setReadTimeout(30000);con.setInstanceFollowRedirects(false);con.setRequestProperty("Accept-Encoding","identity");
                if(offset>0)con.setRequestProperty("Range","bytes="+offset+"-");
                int code=con.getResponseCode();
                if(code>=300&&code<400){String to=con.getHeaderField("Location");if(to==null)throw new IOException("Invalid download redirect");URL next=new URL(url,to);if(!next.getProtocol().equals("https"))throw new IOException("Unsafe download redirect");address=next.toString();continue;}
                if(offset>0&&code==200){part.delete();offset=0;}
                else if(offset>0&&(code!=206||!String.valueOf(con.getHeaderField("Content-Range")).startsWith("bytes "+offset+"-")))throw new IOException("Host cannot safely resume this download");
                else if(offset==0&&code!=200)throw new IOException("Download host returned HTTP "+code);
                String encoding=con.getHeaderField("Content-Encoding");if(encoding!=null&&!encoding.equalsIgnoreCase("identity"))throw new IOException("Unexpected pack content encoding");
                long received=offset;
                try(InputStream in=con.getInputStream();FileOutputStream out=new FileOutputStream(part,offset>0)){
                    byte[] buffer=new byte[131072];int n;long last=0;
                    while((n=in.read(buffer))!=-1){received+=n;if(received>size)throw new IOException("Download exceeds signed size");out.write(buffer,0,n);if(System.currentTimeMillis()-last>500){progress.show("Downloading "+id+": "+received/1048576+" / "+size/1048576+" MiB");last=System.currentTimeMillis();}}
                    out.getFD().sync();
                }
                if(received!=size)throw new IOException("Download interrupted; progress was saved");
                if(!ReleaseIO.sha(part).equals(hash)){part.delete();throw new IOException("Downloaded pack failed SHA-256 verification");}
                if(!part.renameTo(complete))throw new IOException("Cannot publish verified download");return complete;
            }catch(IOException e){failure=e;}finally{if(con!=null)con.disconnect();}
        }
        throw failure==null?new IOException("Too many host redirects"):failure;
    }
}
