import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** Names the window/tab after the current screen: "Screen · Movie Watchlist". */
export function useDocumentTitle(screenTitle: string | undefined): void {
  const { t } = useTranslation();
  const appTitle = t('app.title');
  useEffect(() => {
    document.title = screenTitle ? `${screenTitle} · ${appTitle}` : appTitle;
  }, [screenTitle, appTitle]);
}
