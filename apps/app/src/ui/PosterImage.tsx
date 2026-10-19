import { posterUrl } from '../catalog/tmdbMapping';
import { useTmdbConfig } from '../services';

export function PosterImage({
  posterPath,
  title,
}: {
  posterPath?: string | undefined;
  title: string;
}) {
  const { imageBaseUrl } = useTmdbConfig();
  const src = posterUrl(imageBaseUrl, posterPath);
  if (!src) return <div className="poster poster-empty" aria-hidden />;
  return <img className="poster" src={src} alt={title} loading="lazy" />;
}
