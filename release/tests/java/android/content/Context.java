package android.content;
import java.io.File;
import android.content.res.AssetManager;
/** Host-only filesystem context; never included in the Android build. */
public final class Context {
    private final File root;
    public Context(File root){this.root=root;}
    public File getFilesDir(){File f=new File(root,"private");f.mkdirs();return f;}
    public File getExternalFilesDir(String ignored){File f=new File(root,"external");f.mkdirs();return f;}
    public AssetManager getAssets(){return new AssetManager(new File(root,"assets"));}
    public String getPackageName(){return "com.zirenmidori.gcg.offline";}
}
