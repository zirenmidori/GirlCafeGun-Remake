package com.zirenmidori.gcg.release;

import org.json.*;
import java.io.*;
import java.util.zip.*;

/** Platform-independent bounded byte reconstruction, shared by Android and host tests. */
public final class ApkDeltaBytes {
    private ApkDeltaBytes(){}
    public static File reconstruct(File source,File output,ZipFile update,JSONObject spec,ReleaseDownload.Progress progress)throws IOException{
        try{
            if(!ReleaseIO.sha(source).equals(ReleaseManifest.digest(spec.getString("sourceSha256"))))throw new IOException("APK delta does not match this installed APK");
            long size=ReleaseManifest.number(spec,"size");if(size>2L*1024*1024*1024)throw new IOException("APK exceeds supported size");
            JSONArray ops=spec.getJSONArray("ops");if(ops.length()>100000)throw new IOException("Excessive APK delta operations");
            java.security.MessageDigest digest=ReleaseIO.digest();long total=0;byte[] buffer=new byte[131072];
            try(RandomAccessFile oldFile=new RandomAccessFile(source,"r");FileOutputStream out=new FileOutputStream(output)){
                for(int i=0;i<ops.length();i++){
                    JSONObject op=ops.getJSONObject(i);long offset=ReleaseManifest.number(op,"offset"),length=ReleaseManifest.number(op,"length");
                    if(length>size-total)throw new IOException("APK delta exceeds target size");total+=length;
                    String kind=op.getString("kind");
                    if(kind.equals("copy")){
                        if(offset>oldFile.length()||length>oldFile.length()-offset)throw new IOException("APK copy span out of bounds");
                        oldFile.seek(offset);long left=length;
                        while(left>0){int n=oldFile.read(buffer,0,(int)Math.min(left,buffer.length));if(n<0)throw new EOFException("APK copy truncated");out.write(buffer,0,n);digest.update(buffer,0,n);left-=n;}
                    }else if(kind.equals("literal")){
                        String entry=ReleaseIO.path(op.getString("entry"));if(!entry.matches("apk/[A-Za-z0-9._-]+"))throw new IOException("Invalid APK literal path");
                        ZipEntry ze=update.getEntry(entry);if(ze==null||ze.isDirectory()||ze.getSize()<0||offset>ze.getSize()||length>ze.getSize()-offset)throw new IOException("APK literal span out of bounds");
                        try(InputStream in=update.getInputStream(ze)){
                            long skip=offset;while(skip>0){long n=in.skip(skip);if(n==0){if(in.read()<0)throw new EOFException();n=1;}skip-=n;}
                            long left=length;while(left>0){int n=in.read(buffer,0,(int)Math.min(left,buffer.length));if(n<0)throw new EOFException("APK literal truncated");out.write(buffer,0,n);digest.update(buffer,0,n);left-=n;}
                        }
                    }else throw new IOException("Unknown APK delta operation");
                    if(i%50==0)progress.show("Rebuilding app: "+total/1048576+" / "+size/1048576+" MiB");
                }
                out.getFD().sync();
            }
            if(total!=size||!ReleaseIO.hex(digest.digest()).equals(ReleaseManifest.digest(spec.getString("targetSha256"))))throw new IOException("Reconstructed APK failed integrity verification");return output;
        }catch(JSONException e){throw new IOException("Invalid APK delta",e);}
    }
}
