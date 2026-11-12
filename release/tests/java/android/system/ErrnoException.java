package android.system;
public final class ErrnoException extends Exception {
    public final int errno;public ErrnoException(String what,int errno){super(what);this.errno=errno;}
}
