import type { SyncConfigView } from '@movie-watchlist/core';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { errorKey } from '../errors/errorKey';
import { useServices } from '../services';

/** A translation key plus how to announce it; text is resolved at render so language switches apply. */
type Notice = { kind: 'ok' | 'error'; key: string } | null;

function originOf(url: string): string {
  try {
    return new URL(url.trim()).origin;
  } catch {
    return url.trim();
  }
}

/** WebDAV sync settings. The password field is write-only: the stored value is never shown. */
export function SyncSettings() {
  const { t } = useTranslation();
  const { sync } = useServices();
  const [loaded, setLoaded] = useState<SyncConfigView | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [filePath, setFilePath] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const settingsApi = sync?.settings;

  useEffect(() => {
    if (!settingsApi) return;
    let cancelled = false;
    settingsApi
      .getConfig()
      .then((config) => {
        if (cancelled) return;
        setLoaded(config);
        setServerUrl(config.serverUrl);
        setFilePath(config.filePath);
        setLogin(config.login);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ kind: 'error', key: errorKey(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [settingsApi]);

  if (!settingsApi) return null;
  if (!loaded) return <p className="panel muted">{notice ? t(notice.key) : t('common.loading')}</p>;

  /** Cheap checks that need no round trip; the main process validates everything again. */
  function problemWith(config: SyncConfigView): string | null {
    if (!filePath.startsWith('/') || filePath.endsWith('/')) return 'sync.settings.pathInvalid';
    if (login.trim() === '') return 'sync.settings.loginRequired';
    const destinationChanged =
      originOf(serverUrl) !== originOf(config.serverUrl) || login !== config.login;
    if (password === '' && (!config.hasPassword || destinationChanged)) {
      return 'sync.settings.passwordRequired';
    }
    return null;
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!loaded || !settingsApi) return;
    const problem = problemWith(loaded);
    if (problem) {
      setNotice({ kind: 'error', key: problem });
      return;
    }
    try {
      const next = await settingsApi.saveConfig({
        serverUrl: serverUrl.trim(),
        filePath,
        login,
        ...(password === '' ? {} : { password }),
      });
      setLoaded(next);
      setPassword('');
      setNotice({ kind: 'ok', key: 'sync.settings.saved' });
    } catch (error) {
      setNotice({ kind: 'error', key: errorKey(error) });
    }
  }

  async function handleForget() {
    if (!settingsApi) return;
    try {
      setLoaded(await settingsApi.clearPassword());
      setPassword('');
      setNotice({ kind: 'ok', key: 'sync.settings.passwordForgotten' });
    } catch (error) {
      setNotice({ kind: 'error', key: errorKey(error) });
    }
  }

  return (
    <div className="panel">
      <h2>{t('sync.settings.title')}</h2>
      <form className="editor" onSubmit={(event) => void handleSave(event)}>
        <label>
          {t('sync.settings.serverUrl')}
          <input
            inputMode="url"
            autoComplete="off"
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
          />
        </label>
        <label>
          {t('sync.settings.filePath')}
          <input
            autoComplete="off"
            value={filePath}
            onChange={(event) => setFilePath(event.target.value)}
          />
        </label>
        <label>
          {t('sync.settings.login')}
          <input
            autoComplete="off"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
          />
        </label>
        <label>
          {t('sync.settings.password')}
          <input
            type="password"
            autoComplete="new-password"
            placeholder={loaded.hasPassword ? t('sync.settings.passwordSaved') : ''}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <p className="muted">{t('sync.settings.passwordHint')}</p>
        <div className="row">
          <button type="submit" className="btn-primary">
            {t('sync.settings.save')}
          </button>
          {loaded.hasPassword && (
            <button type="button" className="btn-ghost danger" onClick={() => void handleForget()}>
              {t('sync.settings.forgetPassword')}
            </button>
          )}
          {notice && (
            <span role={notice.kind === 'error' ? 'alert' : 'status'}>{t(notice.key)}</span>
          )}
        </div>
      </form>
    </div>
  );
}
