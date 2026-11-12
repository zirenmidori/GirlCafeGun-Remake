package com.yricky.gcg2.embedded;

import android.content.Context;
import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

final class ServerPayload {
    private static final String ZIP_ASSET = "gcg-server/payload.zip";
    private static final String SHA_ASSET = "gcg-server/payload.sha256";
    private static final String READY = ".payload-ready";
    private static final long MAX_ARCHIVE_BYTES = 64L * 1024 * 1024;
    private static final long MAX_EXTRACTED_BYTES = 128L * 1024 * 1024;
    private static final int MAX_ENTRIES = 10000;
    private static final String[] REQUIRED = {
        "bootstrap.mjs", "package.json", "config/default.json", "dist/index.js",
        "node_modules/zod/package.json", "resources/map/chapter.txt"
    };

    private ServerPayload() {}

    static File root(Context context) throws IOException {
        return directory(context.getFilesDir(), "gcg-server");
    }

    static File directory(File parent, String name) throws IOException {
        File path = checkedChild(parent, name);
        if (!path.isDirectory() && !path.mkdir()) {
            throw new IOException("Cannot create private server directory: " + name);
        }
        return path;
    }

    static File regularFilePath(File parent, String name) throws IOException {
        File path = checkedChild(parent, name);
        if (path.exists() && !path.isFile()) {
            throw new IOException("Server path is not a regular file: " + name);
        }
        return path;
    }

    private static File checkedChild(File parent, String name) throws IOException {
        File base = parent.getCanonicalFile();
        File path = new File(base, name);
        if (!path.equals(path.getCanonicalFile())
                || !path.getPath().startsWith(base.getPath() + File.separator)) {
            throw new IOException("Server path escapes its private directory");
        }
        return path;
    }

    static File install(Context context, File root) throws IOException {
        File selected = com.zirenmidori.gcg.release.ReleaseStore.activeServer(context);
        if (selected != null) {
            if (!hasRequiredFiles(selected)) throw new IOException("Committed server payload is incomplete");
            return selected;
        }
        AssetManager assets = context.getAssets();
        String expected = expectedHash(assets);
        File versions = directory(root, "payloads");
        File target = checkedChild(versions, expected);
        if (isReady(target, expected)) return target;

        // Assets remain immutable for this process. Verify the exact ZIP before extracting it.
        if (!expected.equals(archiveHash(assets))) {
            throw new IOException("Packaged server payload failed its SHA-256 check");
        }
        File stage = directory(versions, ".stage-" + UUID.randomUUID());
        boolean published = false;
        try {
            extract(assets, stage);
            if (!hasRequiredFiles(stage)) throw new IOException("Server payload is incomplete");
            try (FileOutputStream out = new FileOutputStream(checkedChild(stage, READY))) {
                out.write(expected.getBytes(StandardCharsets.US_ASCII));
                out.getFD().sync();
            }
            if (target.exists()) {
                File invalid = checkedChild(versions, ".incomplete-" + UUID.randomUUID());
                if (!target.renameTo(invalid)) {
                    throw new IOException("Cannot preserve the previous incomplete payload");
                }
            }
            if (!stage.renameTo(target)) throw new IOException("Cannot publish the server payload");
            published = true;
            return target;
        } finally {
            if (!published) deleteStagedFiles(stage);
        }
    }

    private static String expectedHash(AssetManager assets) throws IOException {
        byte[] data = new byte[96];
        int size = 0;
        try (InputStream in = assets.open(SHA_ASSET)) {
            int read;
            while (size < data.length && (read = in.read(data, size, data.length - size)) != -1) {
                size += read;
            }
        }
        String digest = new String(data, 0, size, StandardCharsets.US_ASCII).trim();
        if (size == data.length || !digest.matches("[0-9a-f]{64}")) {
            throw new IOException("Invalid packaged server SHA-256");
        }
        return digest;
    }

    private static String archiveHash(AssetManager assets) throws IOException {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IOException("SHA-256 unavailable", e);
        }
        byte[] buffer = new byte[32768];
        long size = 0;
        try (InputStream in = assets.open(ZIP_ASSET, AssetManager.ACCESS_STREAMING)) {
            int n;
            while ((n = in.read(buffer)) != -1) {
                size += n;
                if (size > MAX_ARCHIVE_BYTES) throw new IOException("Server payload ZIP is too large");
                digest.update(buffer, 0, n);
            }
        }
        char[] hex = "0123456789abcdef".toCharArray();
        byte[] bytes = digest.digest();
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            result.append(hex[(value & 0xf0) >>> 4]);
            result.append(hex[value & 0x0f]);
        }
        return result.toString();
    }

    private static boolean isReady(File target, String expected) throws IOException {
        if (!target.isDirectory() || !hasRequiredFiles(target)) return false;
        File marker = checkedChild(target, READY);
        if (!marker.isFile() || marker.length() != 64) return false;
        try (InputStream in = new java.io.FileInputStream(marker)) {
            ByteArrayOutputStream text = new ByteArrayOutputStream(64);
            byte[] buffer = new byte[64];
            int n;
            while ((n = in.read(buffer)) != -1) {
                if (text.size() + n > 64) return false;
                text.write(buffer, 0, n);
            }
            return expected.equals(new String(text.toByteArray(), StandardCharsets.US_ASCII));
        }
    }

    private static boolean hasRequiredFiles(File root) throws IOException {
        for (String name : REQUIRED) {
            File file = checkedChild(root, name);
            if (!file.isFile() || file.length() == 0) return false;
        }
        return true;
    }

    private static String safeEntry(ZipEntry entry) throws IOException {
        String name = entry.getName();
        if (entry.isDirectory()) name = name.substring(0, name.length() - 1);
        if (name.isEmpty() || name.length() > 768 || name.indexOf('\\') >= 0) {
            throw new IOException("Invalid server payload entry");
        }
        String[] segments = name.split("/", -1);
        if (segments.length > 32 || READY.equals(segments[0])) {
            throw new IOException("Invalid server payload entry depth or reserved name");
        }
        for (String segment : segments) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) {
                throw new IOException("Invalid server payload path component");
            }
            for (int i = 0; i < segment.length(); i++) {
                if (Character.isISOControl(segment.charAt(i))) {
                    throw new IOException("Invalid server payload path character");
                }
            }
        }
        return name;
    }

    private static void extract(AssetManager assets, File stage) throws IOException {
        byte[] buffer = new byte[32768];
        Set<String> seen = new HashSet<>();
        long total = 0;
        try (ZipInputStream zip = new ZipInputStream(
                assets.open(ZIP_ASSET, AssetManager.ACCESS_STREAMING))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = safeEntry(entry);
                if (!seen.add(name) || seen.size() > MAX_ENTRIES) {
                    throw new IOException("Duplicate entry or too many server payload entries");
                }
                File path = checkedChild(stage, name);
                if (entry.isDirectory()) {
                    if (!path.isDirectory() && !path.mkdirs()) {
                        throw new IOException("Cannot create payload directory: " + name);
                    }
                    if (zip.read() != -1) throw new IOException("Unexpected payload directory data");
                } else {
                    File parent = path.getParentFile();
                    if ((!parent.isDirectory() && !parent.mkdirs()) || !path.createNewFile()) {
                        throw new IOException("Cannot create payload file: " + name);
                    }
                    try (FileOutputStream out = new FileOutputStream(path)) {
                        int n;
                        while ((n = zip.read(buffer)) != -1) {
                            total += n;
                            if (total > MAX_EXTRACTED_BYTES) {
                                throw new IOException("Extracted server payload is too large");
                            }
                            out.write(buffer, 0, n);
                        }
                    }
                }
                // Reading each entry to EOF also validates its ZIP CRC.
                zip.closeEntry();
            }
        }
    }

    private static void deleteStagedFiles(File path) {
        File[] children = path.listFiles();
        if (children != null) {
            for (File child : children) deleteStagedFiles(child);
        }
        path.delete();
    }
}
