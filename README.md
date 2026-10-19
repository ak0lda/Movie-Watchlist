# Movie Watchlist

Local-first watchlist for movies and series (TMDB catalog, WebDAV sync). pnpm workspaces monorepo.

- `packages/core`: platform-independent TypeScript (types, merge, sync engine)
- `apps/app`: Vite + React UI
- `apps/desktop`: Electron shell (stage 4)

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @movie-watchlist/app dev
```

### Desktop (Electron)

```sh
pnpm --filter @movie-watchlist/desktop start   # builds the app and Electron bundles, then launches
pnpm --filter @movie-watchlist/desktop dev     # same, but the UI comes from the Vite dev server
pnpm test:e2e                                  # real-Electron end-to-end suite (opens hidden windows)
```

Sync settings (server URL, file path, login, app password) are in **Settings**. Defaults:
`https://webdav.yandex.ru` and `/Apps/MovieWatchlist/movies.json`. The app creates missing folders itself.
The password is encrypted with Electron `safeStorage` in the main process and is never sent back to the page.

Copy `.env.example` to `.env` and set your own keys; never commit `.env`.

## Known limitations

- **TMDB key is public.** Anything in a client bundle (or typed into the app) is visible to its user, so the key is not a secret. Use your own key; never commit `.env`.
- **Data safety.** The app asks the browser for persistent storage (`navigator.storage.persist()`). Data can be lost only if the app's data is cleared or the system evicts the storage; sync and JSON export are the safety net.
- **Merge is last-writer-wins per whole record.** Edits to different fields of one title on two devices do not merge; the newer `updatedAt` wins. A device that stays offline for more than 90 days can resurrect a deleted title (tombstones are purged after 90 days). Device clock drift can reorder edits.
- **Search shows the first page of TMDB results only.** Details are cached for 7 days per language and are not synced.
- **Web mode has no sync** (stages 4-6 add the Electron and Android shells).
- **Yandex WebDAV write access was not verified** (spike returned 402 on every write for the test account); the sync protocol was verified against a spec-compliant WebDAV server only.
- **Desktop sync protocol verified against a local spec-compliant WebDAV server only** (real Yandex Disk answered 402 to every write for the spike account).
- **Linux:** without a real secret store (`basic_text` backend) the app refuses to save the sync password instead of storing it effectively unprotected. macOS Keychain and Linux backends were not exercised; the e2e suite ran on Windows (DPAPI).
- **`http` is accepted only for `127.0.0.1`/`localhost` in an unpackaged build with `MW_ALLOW_LOOPBACK_HTTP=1`** (tests and local development); everything else must be `https`.
- **Redirects from the WebDAV server are not followed** (credentials never leave the configured host); a server that redirects is reported as a network error.
- **Desktop minimise trigger** relies on Electron window events (page visibility events do not fire on minimise).
