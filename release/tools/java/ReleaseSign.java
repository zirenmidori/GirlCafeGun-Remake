import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;

/** Exact-byte RSA signatures shared by the release packer and Android verifier. */
public final class ReleaseSign {
    private static String hex(byte[] value) {
        StringBuilder result = new StringBuilder();
        for (byte b : value) result.append(String.format("%02x", b & 255));
        return result.toString();
    }
    private static void feed(Signature signature, Path input) throws Exception {
        try (InputStream stream = Files.newInputStream(input)) {
            byte[] buffer = new byte[1024 * 1024];
            for (int count; (count = stream.read(buffer)) != -1;) signature.update(buffer, 0, count);
        }
    }
    public static void main(String[] args) throws Exception {
        if (args.length == 4 && args[0].equals("verify")) {
            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initVerify(KeyFactory.getInstance("RSA").generatePublic(
                new X509EncodedKeySpec(Files.readAllBytes(Path.of(args[1])))));
            feed(signature, Path.of(args[2]));
            if (!signature.verify(Files.readAllBytes(Path.of(args[3])))) throw new SecurityException("Signature mismatch");
            System.out.println("verified"); return;
        }
        if (args.length < 5) throw new IllegalArgumentException("public/sign keystore password-file alias output [input]");
        char[] password = Files.readString(Path.of(args[2])).trim().toCharArray();
        try {
            KeyStore store = KeyStore.getInstance("PKCS12");
            try (InputStream input = Files.newInputStream(Path.of(args[1]))) { store.load(input, password); }
            Certificate cert = store.getCertificate(args[3]);
            if (cert == null) throw new SecurityException("Signing alias not found");
            if (args[0].equals("public")) {
                byte[] encoded = cert.getPublicKey().getEncoded(); Files.write(Path.of(args[4]), encoded);
                MessageDigest sha = MessageDigest.getInstance("SHA-256");
                System.out.println("certificateSha256=" + hex(sha.digest(cert.getEncoded())));
                System.out.println("publicKeySha256=" + hex(sha.digest(encoded))); return;
            }
            if (!args[0].equals("sign") || args.length != 6) throw new IllegalArgumentException("Invalid signing arguments");
            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initSign((PrivateKey) store.getKey(args[3], password)); feed(signature, Path.of(args[5]));
            Files.write(Path.of(args[4]), signature.sign()); System.out.println("signed");
        } finally { Arrays.fill(password, '\0'); }
    }
}
