// The sync logic is shared with Android and lives in core; the main process only supplies its
// platform ports (JSON config file, safeStorage secret, net.fetch transport).
export {
  ConfiguredSyncBackend as MainSyncBackend,
  type ConfiguredSyncBackendDeps as MainSyncBackendDeps,
  type SyncBackend,
} from '@movie-watchlist/core';
