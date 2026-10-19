import { useSyncExternalStore } from 'react';
import { useServices } from '../services';
import type { SyncStatus } from './SyncService';

/** Current sync status, or null when this platform has no sync (plain browser). */
export function useSyncStatus(): SyncStatus | null {
  const { sync } = useServices();
  const status = useSyncExternalStore(
    sync?.service.subscribe ?? noopSubscribe,
    sync?.service.getStatus ?? getNull,
  );
  return sync ? status : null;
}

const noopSubscribe = () => () => undefined;
const getNull = (): null => null;
