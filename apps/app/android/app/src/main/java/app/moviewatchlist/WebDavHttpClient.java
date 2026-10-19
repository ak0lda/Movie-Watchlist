package app.moviewatchlist;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Plain HTTP client for WebDAV. Unlike Android's HttpURLConnection (and therefore CapacitorHttp) it
 * accepts any method (MKCOL, PROPFIND, ...). Redirects are never followed, so credentials cannot be
 * forwarded to another host, and only https is accepted (http for loopback only when enabled, which
 * the JVM tests use).
 *
 * <p>Pure Java with no Android or Capacitor types, so it is unit-tested on the JVM.
 */
public final class WebDavHttpClient {

    public static final long DEFAULT_TIMEOUT_MS = 30_000;
    public static final int DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

    private static final Pattern METHOD = Pattern.compile("^[A-Z][A-Z-]{1,19}$");

    /** Status, lower-cased header names and the UTF-8 body of a response. */
    public static final class Result {
        public final int status;
        public final Map<String, String> headers;
        public final String body;

        Result(int status, Map<String, String> headers, String body) {
            this.status = status;
            this.headers = headers;
            this.body = body;
        }
    }

    private final OkHttpClient client;
    private final boolean allowLoopbackHttp;
    private final int maxResponseBytes;

    public WebDavHttpClient(long timeoutMs, boolean allowLoopbackHttp, int maxResponseBytes) {
        this.allowLoopbackHttp = allowLoopbackHttp;
        this.maxResponseBytes = maxResponseBytes;
        this.client =
            new OkHttpClient.Builder()
                .followRedirects(false)
                .followSslRedirects(false)
                .retryOnConnectionFailure(false)
                .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .callTimeout(timeoutMs * 2, TimeUnit.MILLISECONDS)
                .build();
    }

    public WebDavHttpClient() {
        this(DEFAULT_TIMEOUT_MS, false, DEFAULT_MAX_RESPONSE_BYTES);
    }

    /**
     * @throws IllegalArgumentException for an invalid method, URL or header (a caller bug or hostile input)
     * @throws IOException for network failures, timeouts and oversized responses
     */
    public Result execute(String method, String url, Map<String, String> headers, String body)
        throws IOException {
        if (method == null || !METHOD.matcher(method).matches()) {
            throw new IllegalArgumentException("Invalid HTTP method");
        }
        checkUrl(url);

        Request.Builder builder = new Request.Builder().url(url);
        MediaType contentType = null;
        if (headers != null) {
            for (Map.Entry<String, String> header : headers.entrySet()) {
                if ("content-type".equals(header.getKey().toLowerCase(Locale.ROOT))) {
                    // OkHttp takes the type from the body object.
                    contentType = MediaType.parse(header.getValue());
                } else {
                    builder.header(header.getKey(), header.getValue()); // rejects CR/LF and control characters
                }
            }
        }

        boolean bodyAllowed = !"GET".equals(method) && !"HEAD".equals(method);
        RequestBody requestBody = null;
        if (bodyAllowed) {
            byte[] bytes = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
            requestBody = RequestBody.create(bytes, contentType);
        }
        builder.method(method, requestBody);

        try (Response response = client.newCall(builder.build()).execute()) {
            Map<String, String> responseHeaders = new LinkedHashMap<>();
            for (String name : response.headers().names()) {
                responseHeaders.put(
                    name.toLowerCase(Locale.ROOT),
                    String.join(", ", response.headers().values(name))
                );
            }
            return new Result(response.code(), responseHeaders, readBody(response.body()));
        }
    }

    private void checkUrl(String url) {
        HttpUrl parsed = url == null ? null : HttpUrl.parse(url);
        if (parsed == null) throw new IllegalArgumentException("Invalid URL");
        if (parsed.isHttps()) return;
        String host = parsed.host();
        boolean loopback = "localhost".equals(host) || "127.0.0.1".equals(host) || "::1".equals(host);
        if (allowLoopbackHttp && loopback) return;
        throw new IllegalArgumentException("Only https is allowed");
    }

    private String readBody(ResponseBody body) throws IOException {
        if (body == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        try (InputStream in = body.byteStream()) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                if (out.size() + read > maxResponseBytes) {
                    throw new IOException("Response is too large");
                }
                out.write(buffer, 0, read);
            }
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
}
