import { useTranslation } from 'react-i18next';
import { useServices } from '../services';
import { useSyncStatus } from '../sync/useSyncStatus';

/** Header control: starts a sync and shows its state. Renders nothing without a sync backend. */
export function SyncButton() {
  const { t } = useTranslation();
  const { sync } = useServices();
  const status = useSyncStatus();
  if (!sync || !status) return null;

  const busy = status.kind === 'syncing';
  return (
    <div className="sync">
      <button type="button" disabled={busy} onClick={() => void sync.service.syncNow('manual')}>
        {t('sync.button')}
      </button>
      <span role="status" className="muted">
        {status.kind === 'syncing' && t('sync.syncing')}
        {status.kind === 'synced' && t('sync.synced')}
        {status.kind === 'error' && t(status.key)}
      </span>
    </div>
  );
}
