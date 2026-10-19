package app.moviewatchlist;

import java.util.Locale;

/**
 * Decides whether an incoming Android intent is a "share text" request worth delivering to the web
 * layer. Pure Java (no Android types) so the rules are unit-tested on the JVM.
 */
public final class ShareIntentFilter {

    public static final String ACTION_SEND = "android.intent.action.SEND";
    /** Same value as Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY. */
    public static final int FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY = 0x00100000;

    public static final int MAX_TEXT_LENGTH = 10_000;

    private ShareIntentFilter() {}

    /**
     * @return the shared text, or null when the intent must be ignored: another action or MIME
     *     type, an empty or oversized text, or a relaunch from the recents list (Android replays
     *     the original intent there, which would repeat an old share).
     */
    public static String accept(String action, String mimeType, CharSequence text, int flags) {
        if (!ACTION_SEND.equals(action)) return null;
        if (mimeType == null || !mimeType.toLowerCase(Locale.ROOT).startsWith("text/plain")) return null;
        if ((flags & FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null;
        if (text == null) return null;
        String value = text.toString();
        if (value.trim().isEmpty() || value.length() > MAX_TEXT_LENGTH) return null;
        return value;
    }
}
