package app.moviewatchlist;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class ShareIntentFilterTest {

    private static final String SEND = "android.intent.action.SEND";

    @Test
    public void acceptsPlainTextShares() {
        assertEquals("Смотри Дюна https://x.example", ShareIntentFilter.accept(SEND, "text/plain", "Смотри Дюна https://x.example", 0));
    }

    @Test
    public void acceptsMimeTypeWithParameters() {
        assertEquals("Dune", ShareIntentFilter.accept(SEND, "text/plain; charset=utf-8", "Dune", 0));
        assertEquals("Dune", ShareIntentFilter.accept(SEND, "TEXT/PLAIN", "Dune", 0));
    }

    @Test
    public void acceptsAnyCharSequence() {
        assertEquals("Dune", ShareIntentFilter.accept(SEND, "text/plain", new StringBuilder("Dune"), 0));
    }

    @Test
    public void ignoresOtherActions() {
        assertNull(ShareIntentFilter.accept("android.intent.action.MAIN", "text/plain", "Dune", 0));
        assertNull(ShareIntentFilter.accept("android.intent.action.SEND_MULTIPLE", "text/plain", "Dune", 0));
        assertNull(ShareIntentFilter.accept("android.intent.action.VIEW", "text/plain", "Dune", 0));
        assertNull(ShareIntentFilter.accept(null, "text/plain", "Dune", 0));
    }

    @Test
    public void ignoresOtherMimeTypes() {
        assertNull(ShareIntentFilter.accept(SEND, "image/png", "Dune", 0));
        assertNull(ShareIntentFilter.accept(SEND, "text/html", "<b>Dune</b>", 0));
        assertNull(ShareIntentFilter.accept(SEND, "*/*", "Dune", 0));
        assertNull(ShareIntentFilter.accept(SEND, null, "Dune", 0));
    }

    @Test
    public void ignoresEmptyOrMissingText() {
        assertNull(ShareIntentFilter.accept(SEND, "text/plain", null, 0));
        assertNull(ShareIntentFilter.accept(SEND, "text/plain", "", 0));
        assertNull(ShareIntentFilter.accept(SEND, "text/plain", "  \n\t ", 0));
    }

    @Test
    public void ignoresOversizedText() {
        String atLimit = "x".repeat(ShareIntentFilter.MAX_TEXT_LENGTH);
        assertEquals(atLimit, ShareIntentFilter.accept(SEND, "text/plain", atLimit, 0));
        assertNull(ShareIntentFilter.accept(SEND, "text/plain", atLimit + "x", 0));
    }

    @Test
    public void ignoresRelaunchFromRecents() {
        int fromHistory = ShareIntentFilter.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY;
        assertNull(ShareIntentFilter.accept(SEND, "text/plain", "Dune", fromHistory));
        assertNull(ShareIntentFilter.accept(SEND, "text/plain", "Dune", fromHistory | 0x10000000));
        assertEquals("Dune", ShareIntentFilter.accept(SEND, "text/plain", "Dune", 0x10000000));
    }

    @Test
    public void historyFlagMatchesTheAndroidConstant() {
        // Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY is documented as 0x00100000.
        assertEquals(1048576, ShareIntentFilter.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY);
    }
}
