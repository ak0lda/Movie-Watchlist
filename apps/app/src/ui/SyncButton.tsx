import { useTranslation } from 'react-i18next';
import { useServices } from '../services';
import { useSyncStatus } from '../sync/useSyncStatus';
import { Icons } from './icons';

/** Header control: starts a sync and shows its state. Renders nothing without a sync backend. */
export function SyncButton() {
  const { t } = useTranslation();
  const { sync } = useServices();
  const status = useSyncStatus();
  if (!sync || !status) return null;

  const busy = status.kind === 'syncing';
  return (
    <div className="sync">
      <span role="status" title={status.kind === 'error' ? t(status.key) : undefined}>
        {status.kind === 'syncing' && t('sync.syncing')}
        {status.kind === 'synced' && t('sync.synced')}
        {status.kind === 'error' && <span className="danger">{t(status.key)}</span>}
      </span>
      <button
        type="button"
        className="btn-sm"
        aria-label={t('sync.button')}
        data-busy={busy}
        disabled={busy}
        onClick={() => void sync.service.syncNow('manual')}
      >
        <Icons.sync />
        <span className="btn-label">{t('sync.button')}</span>
      </button>
    </div>
  );
}
