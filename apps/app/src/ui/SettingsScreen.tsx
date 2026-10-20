import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { EXPORT_FILE_NAME, exportToJson, importFromJson } from '../data/exportImport';
import { errorKey } from '../errors/errorKey';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import i18n, { setLanguage } from '../i18n';
import { SUPPORTED_LANGUAGES, type Language } from '../i18n/resolveLanguage';
import { useServices, useSettings } from '../services';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_IMAGE_BASE_URL,
  normalizeBaseUrl,
} from '../settings/settings';
import { downloadText } from './download';
import { SyncSettings } from './SyncSettings';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

export function SettingsScreen() {
  const { t } = useTranslation();
  const { repo, settings: store, kinopoisk } = useServices();
  const saved = useSettings();
  useDocumentTitle(t('settings.title'));
  const [tmdbKey, setTmdbKey] = useState(saved.tmdbKey);
  const [apiBaseUrl, setApiBaseUrl] = useState(saved.apiBaseUrl);
  const [imageBaseUrl, setImageBaseUrl] = useState(saved.imageBaseUrl);
  const [kinopoiskKey, setKinopoiskKey] = useState(saved.kinopoiskKey);
  const [tmdbNotice, setTmdbNotice] = useState<Notice>(null);
  const [kinopoiskNotice, setKinopoiskNotice] = useState<Notice>(null);
  const [dataNotice, setDataNotice] = useState<Notice>(null);

  function handleSaveTmdb(event: FormEvent) {
    event.preventDefault();
    const invalid = [apiBaseUrl, imageBaseUrl].some(
      (url) => url.trim() !== '' && normalizeBaseUrl(url) === null,
    );
    if (invalid) {
      setTmdbNotice({ kind: 'error', text: t('settings.tmdb.httpsOnly') });
      return;
    }
    store.set({
      ...saved,
      tmdbKey: tmdbKey.trim(),
      apiBaseUrl: apiBaseUrl.trim(),
      imageBaseUrl: imageBaseUrl.trim(),
    });
    setTmdbNotice({ kind: 'ok', text: t('settings.saved') });
  }

  function handleSaveKinopoisk(event: FormEvent) {
    event.preventDefault();
    store.set({ ...saved, kinopoiskKey: kinopoiskKey.trim() });
    setKinopoiskNotice({ kind: 'ok', text: t('settings.saved') });
  }

  async function handleExport() {
    try {
      downloadText(EXPORT_FILE_NAME, await exportToJson(repo));
    } catch (error) {
      setDataNotice({ kind: 'error', text: t(errorKey(error)) });
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { changed, total } = await importFromJson(repo, await file.text());
      setDataNotice({ kind: 'ok', text: t('settings.data.importDone', { changed, total }) });
    } catch (error) {
      setDataNotice({ kind: 'error', text: t(errorKey(error)) });
    } finally {
      input.value = '';
    }
  }

  return (
    <section className="settings">
      <div className="screen-head">
        <h1>{t('settings.title')}</h1>
      </div>

      <div className="panel">
        <h2>{t('settings.language.title')}</h2>
        <select
          aria-label={t('settings.language.title')}
          value={i18n.language}
          onChange={(event) => void setLanguage(event.target.value as Language)}
        >
          {SUPPORTED_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {t(`settings.language.${code}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="panel">
        <h2>{t('settings.tmdb.title')}</h2>
        <form className="editor" onSubmit={handleSaveTmdb}>
          <label>
            {t('settings.tmdb.key')}
            <input
              type="password"
              autoComplete="off"
              value={tmdbKey}
              onChange={(event) => setTmdbKey(event.target.value)}
            />
          </label>
          <p className="muted">{t('settings.tmdb.keyHint')}</p>
          <details>
            <summary>{t('settings.tmdb.advanced')}</summary>
            <label>
              {t('settings.tmdb.apiBaseUrl')}
              <input
                inputMode="url"
                placeholder={DEFAULT_API_BASE_URL}
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
              />
            </label>
            <label>
              {t('settings.tmdb.imageBaseUrl')}
              <input
                inputMode="url"
                placeholder={DEFAULT_IMAGE_BASE_URL}
                value={imageBaseUrl}
                onChange={(event) => setImageBaseUrl(event.target.value)}
              />
            </label>
          </details>
          <div className="row">
            <button type="submit" className="btn-primary">
              {t('settings.save')}
            </button>
            {tmdbNotice && (
              <span role={tmdbNotice.kind === 'error' ? 'alert' : 'status'}>{tmdbNotice.text}</span>
            )}
          </div>
        </form>
      </div>

      {kinopoisk && (
        <div className="panel">
          <h2>{t('settings.kinopoisk.title')}</h2>
          <form className="editor" onSubmit={handleSaveKinopoisk}>
            <label>
              {t('settings.kinopoisk.key')}
              <input
                type="password"
                autoComplete="off"
                value={kinopoiskKey}
                onChange={(event) => setKinopoiskKey(event.target.value)}
              />
            </label>
            <p className="muted">{t('settings.kinopoisk.hint')}</p>
            <div className="row">
              <button type="submit" className="btn-primary">
                {t('settings.kinopoisk.save')}
              </button>
              {kinopoiskNotice && <span role="status">{kinopoiskNotice.text}</span>}
            </div>
          </form>
        </div>
      )}

      <SyncSettings />

      <div className="panel">
        <h2>{t('settings.data.title')}</h2>
        <div className="editor">
          <p className="muted">{t('settings.data.hint')}</p>
          <div className="row">
            <button type="button" onClick={() => void handleExport()}>
              {t('settings.data.export')}
            </button>
            <label className="btn file-button">
              {t('settings.data.import')}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => void handleImport(event)}
              />
            </label>
          </div>
          {dataNotice && (
            <p role={dataNotice.kind === 'error' ? 'alert' : 'status'}>{dataNotice.text}</p>
          )}
        </div>
      </div>
    </section>
  );
}
