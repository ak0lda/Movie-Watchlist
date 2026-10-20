import { posterUrl } from '../catalog/tmdbMapping';
import { useTmdbConfig } from '../services';
import { Icons } from './icons';

export function usePosterUrl(posterPath: string | undefined): string | undefined {
  const { imageBaseUrl } = useTmdbConfig();
  return posterUrl(imageBaseUrl, posterPath);
}

export function PosterImage({
  posterPath,
  title,
}: {
  posterPath?: string | undefined;
  title: string;
}) {
  const src = usePosterUrl(posterPath);
  if (!src) {
    return (
      <div className="poster poster-empty" aria-hidden>
        <Icons.film />
      </div>
    );
  }
  return <img className="poster" src={src} alt={title} loading="lazy" decoding="async" />;
}
