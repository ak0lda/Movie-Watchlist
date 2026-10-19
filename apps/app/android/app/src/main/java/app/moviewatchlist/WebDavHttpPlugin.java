package app.moviewatchlist;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/** Thin Capacitor wrapper around {@link WebDavHttpClient}; plugin methods run off the main thread. */
@CapacitorPlugin(name = "WebDavHttp")
public class WebDavHttpPlugin extends Plugin {

    private WebDavHttpClient client;

    @Override
    public void load() {
        client = new WebDavHttpClient();
    }

    @PluginMethod
    public void request(PluginCall call) {
        String method = call.getString("method");
        String url = call.getString("url");
        String body = call.getString("body");
        Map<String, String> headers = new LinkedHashMap<>();
        JSObject rawHeaders = call.getObject("headers");
        if (rawHeaders != null) {
            Iterator<String> names = rawHeaders.keys();
            while (names.hasNext()) {
                String name = names.next();
                headers.put(name, rawHeaders.optString(name));
            }
        }

        try {
            WebDavHttpClient.Result result = client.execute(method, url, headers, body);
            JSObject responseHeaders = new JSObject();
            for (Map.Entry<String, String> header : result.headers.entrySet()) {
                responseHeaders.put(header.getKey(), header.getValue());
            }
            JSObject response = new JSObject();
            response.put("status", result.status);
            response.put("headers", responseHeaders);
            response.put("body", result.body);
            call.resolve(response);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid request", "INVALID_REQUEST");
        } catch (IOException e) {
            // The message is deliberately generic: exception texts can contain URLs.
            call.reject("Network error", "NETWORK");
        }
    }
}
