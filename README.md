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

Copy `.env.example` to `.env` and set your own keys; never commit `.env`.

## Known limitations

- **TMDB key is public.** Anything in a client bundle (or typed into the app) is visible to its user, so the key is not a secret. Use your own key; never commit `.env`.
- **Data safety.** The app asks the browser for persistent storage (`navigator.storage.persist()`). Data can be lost only if the app's data is cleared or the system evicts the storage; sync and JSON export are the safety net.
- **Merge is last-writer-wins per whole record.** Edits to different fields of one title on two devices do not merge; the newer `updatedAt` wins. A device that stays offline for more than 90 days can resurrect a deleted title (tombstones are purged after 90 days). Device clock drift can reorder edits.
- **Search shows the first page of TMDB results only.** Details are cached for 7 days per language and are not synced.
- **Web mode has no sync** (stages 4-6 add the Electron and Android shells).
- **Yandex WebDAV write access was not verified** (spike returned 402 on every write for the test account); the sync protocol was verified against a spec-compliant WebDAV server only.
