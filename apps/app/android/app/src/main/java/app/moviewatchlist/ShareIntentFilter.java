package app.moviewatchlist;

import java.util.Locale;

/**
 * Decides whether an incoming Android intent is a "share text" request worth delivering to the web
 * layer, and which of its text fields to forward. Pure Java (no Android types) so the rules are
 * unit-tested on the JVM.
 */
public final class ShareIntentFilter {

    public static final String ACTION_SEND = "android.intent.action.SEND";
    /** Same value as Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY. */
    public static final int FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY = 0x00100000;

    public static final int MAX_TEXT_LENGTH = 10_000;

    /** The text fields of a share; a field is null when the sender did not provide it. */
    public static final class Shared {
        public final String text;
        public final String subject;
        public final String title;

        Shared(String text, String subject, String title) {
            this.text = text;
            this.subject = subject;
            this.title = title;
        }
    }

    private ShareIntentFilter() {}

    /**
     * @param text EXTRA_TEXT
     * @param subject EXTRA_SUBJECT (Chrome puts the page title here and only the URL in the text)
     * @param title EXTRA_TITLE
     * @param clipText the text of ClipData item 0, used when EXTRA_TEXT is empty (some apps only
     *     fill the clip)
     * @return the fields to forward, or null when the intent must be ignored: another action or
     *     MIME type, nothing usable, an oversized field, or a relaunch from the recents list
     *     (Android replays the original intent there, which would repeat an old share).
     */
    public static Shared extract(
        String action,
        String mimeType,
        CharSequence text,
        CharSequence subject,
        CharSequence title,
        CharSequence clipText,
        int flags
    ) {
        if (!ACTION_SEND.equals(action)) return null;
        if (mimeType == null || !mimeType.toLowerCase(Locale.ROOT).startsWith("text/plain")) return null;
        if ((flags & FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null;

        String body = clean(text);
        if (body == null) body = clean(clipText);
        String shortSubject = clean(subject);
        String shortTitle = clean(title);
        if (body == null && shortSubject == null && shortTitle == null) return null;

        if (tooLong(body) || tooLong(shortSubject) || tooLong(shortTitle)) return null;
        return new Shared(body, shortSubject, shortTitle);
    }

    private static String clean(CharSequence value) {
        if (value == null) return null;
        String text = value.toString();
        return text.trim().isEmpty() ? null : text;
    }

    private static boolean tooLong(String value) {
        return value != null && value.length() > MAX_TEXT_LENGTH;
    }
}
