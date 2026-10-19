import { describe, expect, it, vi } from 'vitest';
import { routeHref } from '../hooks/useHashRoute';
import { shareHref, startShareHandling, type ShareTargetPlugin } from './shareService';

type Listener = (event: { text?: unknown }) => void;

/** Capacitor semantics: a retained event is delivered when the first listener is added. */
class FakePlugin implements ShareTargetPlugin {
  listeners: Listener[] = [];
  retained: { text?: unknown }[] = [];
  removed = 0;

  addListener(_event: 'shareReceived', listener: Listener) {
    this.listeners.push(listener);
    const pending = this.retained.splice(0);
    setTimeout(() => pending.forEach((event) => listener(event)), 0);
    return Promise.resolve({
      remove: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
        this.removed += 1;
        return Promise.resolve();
      },
    });
  }

  emit(text: unknown) {
    this.listeners.forEach((listener) => listener({ text }));
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('shareHref', () => {
  it('points at the search with the parsed title', () => {
    expect(shareHref('Смотри Дюна https://x.example')).toBe(
      routeHref({ name: 'search', query: 'Дюна' }),
    );
    expect(shareHref('Check out Dune: Part Two')).toBe(
      routeHref({ name: 'search', query: 'Dune: Part Two' }),
    );
  });

  it.each([
    [''],
    ['https://www.kinopoisk.ru/film/1/'],
    ['Смотри!'],
    [undefined],
    [null],
    [42],
    [{}],
  ])('falls back to the "nothing found" marker for %j', (text) => {
    expect(shareHref(text)).toBe('#/search?notFound=1');
  });
});

describe('startShareHandling', () => {
  it('navigates for every share, in order', async () => {
    const plugin = new FakePlugin();
    const navigate = vi.fn();
    startShareHandling(plugin, navigate);
    await tick();
    plugin.emit('Смотри Дюна');
    plugin.emit('Check out Parasite');
    expect(navigate.mock.calls).toEqual([
      [routeHref({ name: 'search', query: 'Дюна' })],
      [routeHref({ name: 'search', query: 'Parasite' })],
    ]);
  });

  it('delivers a share that launched the app (retained until JS subscribes)', async () => {
    const plugin = new FakePlugin();
    plugin.retained.push({ text: 'Рекомендую «Интерстеллар»' });
    const navigate = vi.fn();
    startShareHandling(plugin, navigate);
    expect(navigate).not.toHaveBeenCalled();
    await tick();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      routeHref({ name: 'search', query: 'Интерстеллар' }),
    );
  });

  it('subscribes exactly once and unsubscribes on dispose', async () => {
    const plugin = new FakePlugin();
    const dispose = startShareHandling(plugin, vi.fn());
    await tick();
    expect(plugin.listeners).toHaveLength(1);
    dispose();
    await tick();
    expect(plugin.listeners).toHaveLength(0);
    expect(plugin.removed).toBe(1);
  });

  it('reports a share without a title instead of ignoring it', async () => {
    const plugin = new FakePlugin();
    const navigate = vi.fn();
    startShareHandling(plugin, navigate);
    await tick();
    plugin.emit('https://www.imdb.com/title/tt15239678/');
    expect(navigate).toHaveBeenCalledWith('#/search?notFound=1');
  });
});
