package app.moviewatchlist;

import android.content.ClipData;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Receives "Share" -> text/plain from other apps and forwards the text fields to the web layer as
 * a {@code shareReceived} event ({@code text}, {@code subject}, {@code title}; absent when the
 * sender did not provide them). The event is retained until JS subscribes, which covers the case
 * where the share itself launched the app (cold start).
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    @Override
    public void load() {
        // The intent that launched the activity (cold start).
        if (getActivity() != null) handle(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        // A share that arrives while the app is already running (launchMode singleTask).
        super.handleOnNewIntent(intent);
        handle(intent);
    }

    private CharSequence clipText(Intent intent) {
        ClipData clip = intent.getClipData();
        if (clip == null || clip.getItemCount() == 0 || getContext() == null) return null;
        return clip.getItemAt(0).coerceToText(getContext());
    }

    private void handle(Intent intent) {
        if (intent == null) return;
        ShareIntentFilter.Shared shared =
            ShareIntentFilter.extract(
                intent.getAction(),
                intent.getType(),
                intent.getCharSequenceExtra(Intent.EXTRA_TEXT),
                intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT),
                intent.getCharSequenceExtra(Intent.EXTRA_TITLE),
                clipText(intent),
                intent.getFlags()
            );
        if (shared == null) return;

        // Consume it: a recreated activity (rotation, process restore) must not replay the share.
        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.removeExtra(Intent.EXTRA_SUBJECT);
        intent.removeExtra(Intent.EXTRA_TITLE);
        intent.setClipData(null);
        intent.setAction(Intent.ACTION_MAIN);

        JSObject data = new JSObject();
        if (shared.text != null) data.put("text", shared.text);
        if (shared.subject != null) data.put("subject", shared.subject);
        if (shared.title != null) data.put("title", shared.title);
        notifyListeners("shareReceived", data, true);
    }
}
