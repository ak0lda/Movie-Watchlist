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
