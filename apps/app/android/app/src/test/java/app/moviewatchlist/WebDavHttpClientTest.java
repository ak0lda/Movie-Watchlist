package app.moviewatchlist;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import mockwebserver3.MockResponse;
import mockwebserver3.MockWebServer;
import mockwebserver3.RecordedRequest;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** Runs the real client against a local server: no device or emulator needed. */
public class WebDavHttpClientTest {

    private MockWebServer server;
    private WebDavHttpClient client;

    @Before
    public void setUp() throws IOException {
        server = new MockWebServer();
        server.start();
        client = new WebDavHttpClient(5_000, true, WebDavHttpClient.DEFAULT_MAX_RESPONSE_BYTES);
    }

    @After
    public void tearDown() throws IOException {
        server.close();
    }

    private String url(String path) {
        return server.url(path).toString();
    }

    private static Map<String, String> headers(String... pairs) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put(pairs[i], pairs[i + 1]);
        return map;
    }

    private static MockResponse response(int code) {
        return new MockResponse.Builder().code(code).build();
    }

    @Test
    public void getReturnsStatusLowerCasedHeadersAndUtf8Body() throws Exception {
        server.enqueue(
            new MockResponse.Builder()
                .code(200)
                .addHeader("ETag", "\"v1\"")
                .addHeader("Content-Type", "application/json; charset=utf-8")
                .body("Привет 🎬")
                .build()
        );
        WebDavHttpClient.Result result =
            client.execute("GET", url("/f.json"), Collections.emptyMap(), null);
        assertEquals(200, result.status);
        assertEquals("\"v1\"", result.headers.get("etag"));
        assertEquals("Привет 🎬", result.body);
        RecordedRequest request = server.takeRequest();
        assertEquals("GET", request.getMethod());
        assertEquals("/f.json", request.getTarget());
    }

    @Test
    public void putSendsBodyAndConditionalHeadersVerbatim() throws Exception {
        server.enqueue(new MockResponse.Builder().code(204).addHeader("ETag", "\"v2\"").build());
        WebDavHttpClient.Result result =
            client.execute(
                "PUT",
                url("/f.json"),
                headers(
                    "Authorization", "Basic dXNlcjpwYXNz",
                    "If-Match", "\"v1\"",
                    "Content-Type", "application/json; charset=utf-8"
                ),
                "{\"т\":\"🎬\"}"
            );
        assertEquals(204, result.status);
        assertEquals("\"v2\"", result.headers.get("etag"));
        RecordedRequest request = server.takeRequest();
        assertEquals("PUT", request.getMethod());
        assertEquals("Basic dXNlcjpwYXNz", request.getHeaders().get("Authorization"));
        assertEquals("\"v1\"", request.getHeaders().get("If-Match"));
        assertTrue(request.getHeaders().get("Content-Type").startsWith("application/json"));
        assertEquals("{\"т\":\"🎬\"}", request.getBody().utf8());
    }

    @Test
    public void createOnlyPutUsesIfNoneMatchStar() throws Exception {
        server.enqueue(response(201));
        client.execute("PUT", url("/f.json"), headers("If-None-Match", "*"), "x");
        assertEquals("*", server.takeRequest().getHeaders().get("If-None-Match"));
    }

    @Test
    public void mkcolWorksUnlikeHttpUrlConnection() throws Exception {
        server.enqueue(response(201));
        WebDavHttpClient.Result result =
            client.execute("MKCOL", url("/Apps/"), headers("Authorization", "Basic eA=="), null);
        assertEquals(201, result.status);
        RecordedRequest request = server.takeRequest();
        assertEquals("MKCOL", request.getMethod());
        assertEquals("/Apps/", request.getTarget());
    }

    @Test
    public void propfindWithBodyWorks() throws Exception {
        server.enqueue(response(207));
        WebDavHttpClient.Result result =
            client.execute(
                "PROPFIND",
                url("/"),
                headers("Depth", "0", "Content-Type", "application/xml"),
                "<propfind xmlns=\"DAV:\"><prop><getetag/></prop></propfind>"
            );
        assertEquals(207, result.status);
        RecordedRequest request = server.takeRequest();
        assertEquals("PROPFIND", request.getMethod());
        assertEquals("0", request.getHeaders().get("Depth"));
        assertTrue(request.getBody().utf8().contains("getetag"));
    }

    @Test
    public void errorStatusesAreResultsNotExceptions() throws Exception {
        int[] codes = {401, 402, 403, 404, 405, 409, 412, 423, 429, 500, 503};
        for (int code : codes) {
            server.enqueue(response(code));
            WebDavHttpClient.Result result =
                client.execute("PUT", url("/f"), headers("If-Match", "\"x\""), "body");
            assertEquals(code, result.status);
        }
    }

    @Test
    public void unauthorizedWithRequestBodyDoesNotThrow() throws Exception {
        // HttpURLConnection fails with "cannot retry due to server authentication, in streaming
        // mode" here; OkHttp just reports the 401 so the app can show "credentials rejected".
        server.enqueue(
            new MockResponse.Builder()
                .code(401)
                .addHeader("WWW-Authenticate", "Basic realm=\"Yandex.Disk\"")
                .build()
        );
        WebDavHttpClient.Result result =
            client.execute("PUT", url("/f"), headers("Authorization", "Basic eA=="), "payload");
        assertEquals(401, result.status);
    }

    @Test
    public void redirectsAreNotFollowedAndNothingIsSentToTheTarget() throws Exception {
        try (MockWebServer other = new MockWebServer()) {
            other.start();
            server.enqueue(
                new MockResponse.Builder()
                    .code(302)
                    .addHeader("Location", other.url("/stolen").toString())
                    .build()
            );
            WebDavHttpClient.Result result =
                client.execute("GET", url("/f"), headers("Authorization", "Basic eA=="), null);
            assertEquals(302, result.status);
            assertEquals(other.url("/stolen").toString(), result.headers.get("location"));
            assertEquals(0, other.getRequestCount());
        }
    }

    @Test
    public void multipleHeaderValuesAreJoined() throws Exception {
        server.enqueue(
            new MockResponse.Builder().code(200).addHeader("DAV", "1").addHeader("DAV", "2").build()
        );
        WebDavHttpClient.Result result =
            client.execute("GET", url("/"), Collections.emptyMap(), null);
        assertEquals("1, 2", result.headers.get("dav"));
    }

    @Test
    public void emptyBodyBecomesEmptyString() throws Exception {
        server.enqueue(response(404));
        assertEquals("", client.execute("GET", url("/x"), Collections.emptyMap(), null).body);
    }

    // --- safety rules -------------------------------------------------------------------------

    @Test
    public void plainHttpIsRejectedUnlessLoopbackIsExplicitlyEnabled() {
        WebDavHttpClient strict = new WebDavHttpClient();
        assertThrows(
            IllegalArgumentException.class,
            () -> strict.execute("GET", "http://127.0.0.1:1/", Collections.emptyMap(), null)
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> strict.execute("GET", "http://example.com/", Collections.emptyMap(), null)
        );
    }

    @Test
    public void plainHttpToANonLoopbackHostIsRejectedEvenWhenLoopbackIsEnabled() {
        assertThrows(
            IllegalArgumentException.class,
            () -> client.execute("GET", "http://example.com/", Collections.emptyMap(), null)
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> client.execute("GET", "http://localhost.evil.com/", Collections.emptyMap(), null)
        );
    }

    @Test
    public void invalidUrlsAreRejected() {
        for (String bad : new String[] {null, "", "not a url", "ftp://example.com/", "file:///etc/passwd"}) {
            assertThrows(
                IllegalArgumentException.class,
                () -> client.execute("GET", bad, Collections.emptyMap(), null)
            );
        }
    }

    @Test
    public void invalidMethodsAreRejected() {
        for (String bad : new String[] {null, "", "get", "G", "PU T", "PUT\r\nX: y", "A".repeat(30), "GET /"}) {
            assertThrows(
                IllegalArgumentException.class,
                () -> client.execute(bad, url("/"), Collections.emptyMap(), null)
            );
        }
    }

    @Test
    public void headerInjectionIsRejected() {
        assertThrows(
            IllegalArgumentException.class,
            () -> client.execute("GET", url("/"), headers("If-Match", "a\r\nX-Evil: 1"), null)
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> client.execute("GET", url("/"), headers("Bad\nName", "v"), null)
        );
        assertEquals(0, server.getRequestCount());
    }

    // --- failures -----------------------------------------------------------------------------

    @Test
    public void slowServerTimesOut() {
        server.enqueue(new MockResponse.Builder().code(200).body("late").bodyDelay(3, TimeUnit.SECONDS).build());
        WebDavHttpClient impatient =
            new WebDavHttpClient(300, true, WebDavHttpClient.DEFAULT_MAX_RESPONSE_BYTES);
        assertThrows(
            IOException.class,
            () -> impatient.execute("GET", url("/"), Collections.emptyMap(), null)
        );
    }

    @Test
    public void refusedConnectionIsAnIOException() throws Exception {
        String dead = url("/");
        server.close();
        assertThrows(
            IOException.class,
            () -> client.execute("GET", dead, Collections.emptyMap(), null)
        );
    }

    @Test
    public void oversizedResponsesAreRejected() {
        server.enqueue(new MockResponse.Builder().code(200).body("x".repeat(5_000)).build());
        WebDavHttpClient small = new WebDavHttpClient(5_000, true, 1_000);
        IOException error =
            assertThrows(
                IOException.class,
                () -> small.execute("GET", url("/"), Collections.emptyMap(), null)
            );
        assertTrue(error.getMessage().contains("too large"));
    }

    @Test
    public void aResponseExactlyAtTheLimitIsAccepted() throws Exception {
        server.enqueue(new MockResponse.Builder().code(200).body("x".repeat(1_000)).build());
        WebDavHttpClient small = new WebDavHttpClient(5_000, true, 1_000);
        assertEquals(1_000, small.execute("GET", url("/"), Collections.emptyMap(), null).body.length());
    }

    @Test
    public void requestWithoutContentTypeStillSendsTheBody() throws Exception {
        server.enqueue(response(201));
        client.execute("PUT", url("/f"), Collections.emptyMap(), "plain");
        RecordedRequest request = server.takeRequest();
        assertEquals("plain", request.getBody().utf8());
        assertFalse(request.getHeaders().names().isEmpty());
        assertNull(request.getHeaders().get("If-Match"));
    }
}
