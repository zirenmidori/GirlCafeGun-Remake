package com.zirenmidori.gcg.release;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.*;

public final class ReleaseManifest {
    public static final String APP_ID = "com.zirenmidori.gcg.offline";
    public static final long MAX_PACK = 180L * 1024 * 1024;
    public final JSONObject json;
    public final byte[] raw;
    public final String hash;
    public final String releaseId;
    public final String kind;
    public final LinkedHashMap<String, JSONObject> files = new LinkedHashMap<>();
    public final LinkedHashMap<String, JSONObject> packs = new LinkedHashMap<>();
    public final LinkedHashSet<String> remove = new LinkedHashSet<>();

    private ReleaseManifest(byte[] bytes) throws IOException {
        raw = bytes; hash = ReleaseIO.hex(ReleaseIO.digest().digest(bytes));
        try {
            json = new JSONObject(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
            if (number(json, "schemaVersion") != 1 || !APP_ID.equals(json.getString("packageName"))) throw new IOException("Wrong release package/schema");
            kind = json.getString("kind");
            if (!kind.equals("full") && !kind.equals("delta")) throw new IOException("Unknown manifest kind");
            releaseId = identifier(json.getString("releaseId"));
            number(json, "minApkVersionCode");
            if (kind.equals("delta")) identifier(json.getString("baseReleaseId"));
            JSONArray a = json.getJSONArray("files");
            if (a.length() > 100000) throw new IOException("Too many resources");
            long total = 0;
            for (int i = 0; i < a.length(); i++) {
                JSONObject row = a.getJSONObject(i); String name = resource(row.getString("path"));
                long size = number(row, "size"); total += size;
                if (size > 2L * 1024 * 1024 * 1024 || total > 32L * 1024 * 1024 * 1024) throw new IOException("Excessive resource expansion");
                digest(row.getString("sha256"));
                if (files.put(name, row) != null) throw new IOException("Duplicate resource path");
            }
            JSONArray p = json.getJSONArray("packs");
            if (p.length() > 1024) throw new IOException("Too many packs");
            for (int i = 0; i < p.length(); i++) {
                JSONObject row = p.getJSONObject(i); String id = identifier(row.getString("id"));
                if (number(row, "size") > MAX_PACK || !row.getString("url").startsWith("https://")) throw new IOException("Invalid public pack URL/size");
                digest(row.getString("sha256"));
                if (packs.put(id, row) != null) throw new IOException("Duplicate pack ID");
            }
            if (kind.equals("full") && packs.isEmpty() && !files.isEmpty()) throw new IOException("Full manifest lacks download packs");
            if (!packs.isEmpty()) for (JSONObject row : files.values()) if (!packs.containsKey(row.getString("pack"))) throw new IOException("Resource references unknown pack");
            JSONArray deleted = json.optJSONArray("remove");
            if (deleted != null) for (int i = 0; i < deleted.length(); i++) {
                String name = resource(deleted.getString(i));
                if (!remove.add(name) || files.containsKey(name)) throw new IOException("Duplicate/conflicting removal");
            }
            if (kind.equals("full") && !remove.isEmpty()) throw new IOException("Full manifest cannot delete resources");
            JSONObject server = json.optJSONObject("serverPayload");
            if (server != null) {
                if (!"server/payload.zip".equals(server.getString("entry")) || number(server,"size") > 64L*1024*1024
                        || number(server,"expandedSize") > 128L*1024*1024 || number(server,"entries") > 10000)
                    throw new IOException("Invalid server payload bounds");
                digest(server.getString("sha256"));
            }
        } catch (JSONException e) { throw new IOException("Invalid signed manifest", e); }
    }
    public static ReleaseManifest verify(Context context, byte[] raw, byte[] signature) throws IOException {
        return verify(context,raw,signature,null,false);
    }
    public static byte[] publicKey(Context context) throws IOException {
        try(InputStream in=context.getAssets().open("gcg-release/publickey.der")){return ReleaseIO.read(in,8192);}
    }
    public static ReleaseManifest verify(Context context, byte[] raw, byte[] signature, byte[] publisher, boolean trustOnce) throws IOException {
        try {
            byte[] embedded=publicKey(context),key=publisher==null?embedded:publisher;
            boolean foreign=!java.util.Arrays.equals(embedded,key);
            if(foreign&&!trustOnce)throw new IOException("Publisher requires explicit one-time trust");
            PublicKey publicKey = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(key));
            Signature verifier = Signature.getInstance("SHA256withRSA"); verifier.initVerify(publicKey); verifier.update(raw);
            if (!verifier.verify(signature)) throw new IOException("Release signature is invalid");
            ReleaseManifest manifest=new ReleaseManifest(raw);
            if(foreign&&(!manifest.kind.equals("delta")||manifest.json.optJSONObject("apk")!=null))throw new IOException("Foreign publishers may provide local data-only deltas");
            return manifest;
        } catch (GeneralSecurityException e) { throw new IOException("Cannot verify release signature", e); }
    }
    public static ReleaseManifest bundled(Context context) throws IOException {
        byte[] raw, sig;
        try (InputStream in = context.getAssets().open("gcg-release/manifest.json")) { raw = ReleaseIO.read(in, 16L*1024*1024); }
        try (InputStream in = context.getAssets().open("gcg-release/manifest.sig")) { sig = ReleaseIO.read(in, 8192); }
        return verify(context, raw, sig);
    }
    public static String digest(String value) throws IOException {
        if (!value.matches("[0-9a-f]{64}")) throw new IOException("Invalid SHA-256"); return value;
    }
    public static String identifier(String value) throws IOException {
        if (!value.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,79}")) throw new IOException("Invalid release/pack ID"); return value;
    }
    public static long number(JSONObject row, String key) throws IOException {
        Object v = row.opt(key);
        if (!(v instanceof Integer || v instanceof Long)) throw new IOException("Expected integer: " + key);
        long n = ((Number)v).longValue(); if (n < 0 || n > ReleaseIO.MAX_EXACT) throw new IOException("Invalid integer: " + key); return n;
    }
    public static String resource(String name) throws IOException {
        ReleaseIO.path(name); String lower = name.toLowerCase(Locale.ROOT);
        if (lower.startsWith(".") || lower.contains("/.") || lower.startsWith("gcg-server/") || lower.startsWith("unity/")
                || lower.startsWith("rendertextures/") || lower.startsWith("updates/") || lower.contains("state.json"))
            throw new IOException("Protected path is outside resource namespace");
        if (name.equals("version.data") || name.equals("Raw/pv_sound.txt") || name.endsWith(".u") || name.startsWith("Raw/") && name.endsWith(".mp4")
                || name.startsWith("AutoAudio/Android/") && (name.endsWith(".bnk") || name.endsWith(".wem"))) return name;
        throw new IOException("Unsupported game resource: " + name);
    }
}
