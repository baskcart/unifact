package unispec.uuid7;

import java.security.SecureRandom;
import java.util.UUID;

/** RFC 9562 UUID version 7. Java 21, no libraries beyond the JDK. */
public final class Uuid7 {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static long lastTimestamp = Long.MIN_VALUE;

    private Uuid7() {}

    public static synchronized UUID generate() {
        long timestamp = System.currentTimeMillis();
        if (timestamp < lastTimestamp) {
            timestamp = lastTimestamp;
        }
        lastTimestamp = timestamp;

        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        bytes[0] = (byte) (timestamp >>> 40);
        bytes[1] = (byte) (timestamp >>> 32);
        bytes[2] = (byte) (timestamp >>> 24);
        bytes[3] = (byte) (timestamp >>> 16);
        bytes[4] = (byte) (timestamp >>> 8);
        bytes[5] = (byte) timestamp;
        bytes[6] = (byte) ((bytes[6] & 0x0f) | 0x70);
        bytes[8] = (byte) ((bytes[8] & 0x3f) | 0x80);

        long most = 0;
        long least = 0;
        for (int i = 0; i < 8; i++) {
            most = (most << 8) | (bytes[i] & 0xffL);
        }
        for (int i = 8; i < 16; i++) {
            least = (least << 8) | (bytes[i] & 0xffL);
        }
        return new UUID(most, least);
    }
}
