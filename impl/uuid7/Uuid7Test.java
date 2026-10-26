package unispec.uuid7;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class Uuid7Test {
    @Test
    void versionNibbleIs7() {
        assertEquals(7, Uuid7.generate().version());
    }

    @Test
    void variantIsRfc() {
        assertEquals(2, Uuid7.generate().variant());
    }

    @Test
    void timestampIsWithinASecondOfNow() {
        long before = System.currentTimeMillis();
        long stamp = timestamp(Uuid7.generate());
        long after = System.currentTimeMillis();
        assertTrue(stamp >= before - 1000 && stamp <= after + 1000);
    }

    @Test
    void aThousandCallsAreUnique() {
        HashSet<UUID> ids = new HashSet<>();
        for (int i = 0; i < 1000; i++) {
            assertTrue(ids.add(Uuid7.generate()));
        }
    }

    @Test
    void sortOrderMatchesTimeAcrossMilliseconds() throws InterruptedException {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            ids.add(Uuid7.generate());
            Thread.sleep(2);
        }
        List<UUID> byId = new ArrayList<>(ids);
        byId.sort(Comparator.naturalOrder());
        List<UUID> byTime = new ArrayList<>(ids);
        byTime.sort(Comparator.comparingLong(Uuid7Test::timestamp));
        assertEquals(byTime, byId);
    }

    private static long timestamp(UUID id) {
        return id.getMostSignificantBits() >>> 16;
    }
}
