package com.zirenmidori.gcg.release;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

public final class ReleaseIO {
    public static final long MAX_EXACT = 9007199254740991L;
    private ReleaseIO() {}
    public static String hex(byte[] value) {
        StringBuilder out = new StringBuilder(value.length * 2);
        for (byte b : value) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    public static MessageDigest digest() throws IOException {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (java.security.GeneralSecurityException e) { throw new IOException(e); }
    }
    public static String sha(File file) throws IOException {
        MessageDigest hash = digest();
        try (InputStream in = new FileInputStream(file)) {
            byte[] b = new byte[131072]; int n;
            while ((n = in.read(b)) != -1) hash.update(b, 0, n);
        }
        return hex(hash.digest());
    }
    public static byte[] read(InputStream in, long max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[32768]; int n;
        while ((n = in.read(b)) != -1) {
            if ((long)out.size() + n > max) throw new IOException("Input exceeds declared limit");
            out.write(b, 0, n);
        }
        return out.toByteArray();
    }
    public static byte[] read(File file, long max) throws IOException {
        try (InputStream in = new FileInputStream(file)) { return read(in, max); }
    }
    public static File dir(File file) throws IOException {
        if ((!file.isDirectory() && !file.mkdirs()) || !file.equals(file.getCanonicalFile()))
            throw new IOException("Unsafe or unavailable directory: " + file.getName());
        return file;
    }
    public static String path(String name) throws IOException {
        if (name.length() == 0 || name.length() > 768 || name.startsWith("/") || name.indexOf('\\') >= 0 || name.indexOf(':') >= 0)
            throw new IOException("Invalid resource path");
        String[] pieces = name.split("/", -1);
        if (pieces.length > 32) throw new IOException("Resource path too deep");
        for (String part : pieces) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new IOException("Invalid path component");
            for (int i = 0; i < part.length(); i++) if (part.charAt(i) < 32 || part.charAt(i) > 126) throw new IOException("Non-ASCII resource path");
        }
        return name;
    }
    public static File child(File base, String name) throws IOException {
        path(name); File root = base.getCanonicalFile(); File file = new File(root, name);
        if (!file.equals(file.getCanonicalFile()) || !file.getPath().startsWith(root.getPath() + File.separator))
            throw new IOException("Resource path escapes owned directory");
        return file;
    }
    public static void atomic(File file, byte[] bytes) throws IOException {
        dir(file.getParentFile()); File stage = child(file.getParentFile(), ".write-" + UUID.randomUUID());
        try {
            try (FileOutputStream out = new FileOutputStream(stage)) { out.write(bytes); out.getFD().sync(); }
            rename(stage,file);
        } finally { if (stage.exists()) stage.delete(); }
    }
    public static void rename(File source,File destination)throws IOException{
        try{android.system.Os.rename(source.getAbsolutePath(),destination.getAbsolutePath());syncDirectory(destination.getParentFile());if(!source.getParentFile().equals(destination.getParentFile()))syncDirectory(source.getParentFile());}
        catch(android.system.ErrnoException e){throw new IOException("Cannot atomically publish owned file",e);}
    }
    private static void syncDirectory(File directory)throws IOException{
        java.io.FileDescriptor fd=null;
        try{fd=android.system.Os.open(directory.getAbsolutePath(),android.system.OsConstants.O_RDONLY,0);android.system.Os.fsync(fd);}
        catch(android.system.ErrnoException e){
            // Some emulated/FUSE volumes do not implement directory fsync. Regular
            // file data and the private ext4 transaction journal are still synced.
            if(e.errno!=android.system.OsConstants.EINVAL&&e.errno!=android.system.OsConstants.ENOTSUP)throw new IOException("Cannot sync transaction directory",e);
        }finally{if(fd!=null)try{android.system.Os.close(fd);}catch(android.system.ErrnoException e){throw new IOException(e);}}
    }
    public static void copy(InputStream in, File target, long expectedSize, String expectedHash) throws IOException {
        if (expectedSize < 0 || expectedSize > MAX_EXACT) throw new IOException("Invalid size");
        dir(target.getParentFile()); MessageDigest hash = digest(); long size = 0;
        try (FileOutputStream out = new FileOutputStream(target)) {
            byte[] b = new byte[131072]; int n;
            while ((n = in.read(b)) != -1) {
                size += n; if (size > expectedSize) throw new IOException("Resource exceeds declared size");
                hash.update(b, 0, n); out.write(b, 0, n);
            }
            out.getFD().sync();
        }
        if (size != expectedSize || !hex(hash.digest()).equals(expectedHash)) {
            target.delete(); throw new IOException("Resource integrity check failed: " + target.getName());
        }
    }
    public static void copy(File source, File target, long size, String hash) throws IOException {
        try (InputStream in = new FileInputStream(source)) { copy(in, target, size, hash); }
    }
    public static void deleteTree(File file) throws IOException {
        if (!file.equals(file.getCanonicalFile())) throw new IOException("Refusing to traverse symbolic link");
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        if (file.exists() && !file.delete()) throw new IOException("Cannot remove owned staging file");
    }
    public static byte[] utf8(String text) { return text.getBytes(StandardCharsets.UTF_8); }
}
