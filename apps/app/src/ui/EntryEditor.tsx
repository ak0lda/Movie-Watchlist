import type { MovieEntry, WatchStatus } from '@movie-watchlist/core';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntryPatch } from '../data/repository';
import { Icons } from './icons';

const STATUSES: readonly WatchStatus[] = ['want', 'watching', 'watched'];
const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

interface EntryEditorProps {
  entry: MovieEntry;
  onSave: (patch: EntryPatch) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}

/** Mount with `key={entry.id}`: the form state is initialised once from the entry. */
export function EntryEditor({ entry, onSave, onRemove }: EntryEditorProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<WatchStatus>(entry.status);
  const [rating, setRating] = useState(entry.rating === undefined ? '' : String(entry.rating));
  const [note, setNote] = useState(entry.note ?? '');
  const [source, setSource] = useState(entry.source ?? '');
  const [saved, setSaved] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onSave({ status, rating: rating === '' ? null : Number(rating), note, source });
    setSaved(true);
  }

  return (
    <form className="editor" onSubmit={(event) => void handleSubmit(event)}>
      <div className="editor-grid">
        <label>
          {t('editor.status')}
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as WatchStatus);
              setSaved(false);
            }}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('editor.rating')}
          <select
            value={rating}
            onChange={(event) => {
              setRating(event.target.value);
              setSaved(false);
            }}
          >
            <option value="">{t('editor.ratingNone')}</option>
            {RATINGS.map((value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t('editor.source')}
        <input
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <label>
        {t('editor.note')}
        <textarea
          rows={3}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <div className="row">
        <button type="submit" className="btn-primary">
          {t('editor.save')}
        </button>
        {saved && (
          <span role="status" className="in-list">
            <Icons.check />
            {t('editor.saved')}
          </span>
        )}
      </div>
      <div className="divider" />
      {confirmingRemove ? (
        <div className="confirm">
          <span>{t('editor.removeConfirm')}</span>
          <button
            type="button"
            className="btn-primary danger btn-sm"
            onClick={() => void onRemove()}
          >
            {t('editor.removeYes')}
          </button>
          <button type="button" className="btn-sm" onClick={() => setConfirmingRemove(false)}>
            {t('editor.cancel')}
          </button>
        </div>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn-ghost danger btn-sm"
            onClick={() => setConfirmingRemove(true)}
          >
            <Icons.trash />
            {t('editor.remove')}
          </button>
        </div>
      )}
    </form>
  );
}
