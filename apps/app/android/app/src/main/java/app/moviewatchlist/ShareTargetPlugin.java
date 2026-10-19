package app.moviewatchlist;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Receives "Share" -> text/plain from other apps and forwards the text to the web layer as a
 * {@code shareReceived} event. The event is retained until JS subscribes, which covers the case
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

    private void handle(Intent intent) {
        if (intent == null) return;
        String text =
            ShareIntentFilter.accept(
                intent.getAction(),
                intent.getType(),
                intent.getCharSequenceExtra(Intent.EXTRA_TEXT),
                intent.getFlags()
            );
        if (text == null) return;

        // Consume it: a recreated activity (rotation, process restore) must not replay the share.
        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.setAction(Intent.ACTION_MAIN);

        JSObject data = new JSObject();
        data.put("text", text);
        notifyListeners("shareReceived", data, true);
    }
}
