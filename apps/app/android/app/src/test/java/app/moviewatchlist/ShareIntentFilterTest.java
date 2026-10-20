package app.moviewatchlist;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import app.moviewatchlist.ShareIntentFilter.Shared;
import org.junit.Test;

public class ShareIntentFilterTest {

    private static final String SEND = "android.intent.action.SEND";

    private static Shared text(String text) {
        return ShareIntentFilter.extract(SEND, "text/plain", text, null, null, null, 0);
    }

    @Test
    public void acceptsPlainTextShares() {
        Shared shared = text("Смотри Дюна https://x.example");
        assertEquals("Смотри Дюна https://x.example", shared.text);
        assertNull(shared.subject);
        assertNull(shared.title);
    }

    @Test
    public void acceptsMimeTypeWithParameters() {
        assertEquals("Dune", ShareIntentFilter.extract(SEND, "text/plain; charset=utf-8", "Dune", null, null, null, 0).text);
        assertEquals("Dune", ShareIntentFilter.extract(SEND, "TEXT/PLAIN", "Dune", null, null, null, 0).text);
    }

    @Test
    public void acceptsAnyCharSequence() {
        assertEquals("Dune", ShareIntentFilter.extract(SEND, "text/plain", new StringBuilder("Dune"), null, null, null, 0).text);
    }

    @Test
    public void forwardsSubjectAndTitleNextToTheText() {
        // Chrome: the URL is the text and the page title is the subject.
        Shared shared =
            ShareIntentFilter.extract(SEND, "text/plain", "https://x.example/film/1", "Дюна (2021) — Кинопоиск", "Дюна", null, 0);
        assertEquals("https://x.example/film/1", shared.text);
        assertEquals("Дюна (2021) — Кинопоиск", shared.subject);
        assertEquals("Дюна", shared.title);
    }

    @Test
    public void deliversASubjectOnlyShare() {
        Shared shared = ShareIntentFilter.extract(SEND, "text/plain", null, "Дюна", null, null, 0);
        assertNotNull(shared);
        assertNull(shared.text);
        assertEquals("Дюна", shared.subject);
    }

    @Test
    public void fallsBackToClipDataWhenTheTextExtraIsEmpty() {
        assertEquals("From the clip", ShareIntentFilter.extract(SEND, "text/plain", null, null, null, "From the clip", 0).text);
        assertEquals("From the clip", ShareIntentFilter.extract(SEND, "text/plain", "   ", null, null, "From the clip", 0).text);
        assertEquals("Real text", ShareIntentFilter.extract(SEND, "text/plain", "Real text", null, null, "From the clip", 0).text);
    }

    @Test
    public void blankFieldsAreDropped() {
        Shared shared = ShareIntentFilter.extract(SEND, "text/plain", "Dune", "  ", "", null, 0);
        assertEquals("Dune", shared.text);
        assertNull(shared.subject);
        assertNull(shared.title);
    }

    @Test
    public void ignoresOtherActions() {
        assertNull(ShareIntentFilter.extract("android.intent.action.MAIN", "text/plain", "Dune", null, null, null, 0));
        assertNull(ShareIntentFilter.extract("android.intent.action.SEND_MULTIPLE", "text/plain", "Dune", null, null, null, 0));
        assertNull(ShareIntentFilter.extract("android.intent.action.VIEW", "text/plain", "Dune", null, null, null, 0));
        assertNull(ShareIntentFilter.extract(null, "text/plain", "Dune", null, null, null, 0));
    }

    @Test
    public void ignoresOtherMimeTypes() {
        assertNull(ShareIntentFilter.extract(SEND, "image/png", "Dune", null, null, null, 0));
        assertNull(ShareIntentFilter.extract(SEND, "text/html", "<b>Dune</b>", null, null, null, 0));
        assertNull(ShareIntentFilter.extract(SEND, "*/*", "Dune", null, null, null, 0));
        assertNull(ShareIntentFilter.extract(SEND, null, "Dune", null, null, null, 0));
    }

    @Test
    public void ignoresIntentsWithNothingUsable() {
        assertNull(text(null));
        assertNull(text(""));
        assertNull(text("  \n\t "));
        assertNull(ShareIntentFilter.extract(SEND, "text/plain", null, " ", "\n", "  ", 0));
    }

    @Test
    public void ignoresOversizedFields() {
        String atLimit = "x".repeat(ShareIntentFilter.MAX_TEXT_LENGTH);
        assertEquals(atLimit, text(atLimit).text);
        assertNull(text(atLimit + "x"));
        assertNull(ShareIntentFilter.extract(SEND, "text/plain", "ok", atLimit + "x", null, null, 0));
        assertNull(ShareIntentFilter.extract(SEND, "text/plain", "ok", null, atLimit + "x", null, 0));
    }

    @Test
    public void ignoresRelaunchFromRecents() {
        int fromHistory = ShareIntentFilter.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY;
        assertNull(ShareIntentFilter.extract(SEND, "text/plain", "Dune", null, null, null, fromHistory));
        assertNull(ShareIntentFilter.extract(SEND, "text/plain", "Dune", null, null, null, fromHistory | 0x10000000));
        assertEquals("Dune", ShareIntentFilter.extract(SEND, "text/plain", "Dune", null, null, null, 0x10000000).text);
    }

    @Test
    public void historyFlagMatchesTheAndroidConstant() {
        // Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY is documented as 0x00100000.
        assertEquals(1048576, ShareIntentFilter.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY);
    }
}
