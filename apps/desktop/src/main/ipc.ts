import { ConfigError, toBridgeResult, type BridgeResult } from '@movie-watchlist/core';
import { CHANNELS, type ChannelName } from '../shared/channels';
import type { SyncBackend } from './syncBackend';
import {
  isTrustedSender,
  validateNoArgs,
  validateSaveConfig,
  validateUploadArgs,
} from './validate';

/** The facts about the calling frame that matter for trust (extracted from Electron's event). */
export interface IpcSender {
  url: string | undefined;
  isMainFrame: boolean;
}

export type IpcHandler = (sender: IpcSender, ...args: unknown[]) => Promise<BridgeResult<unknown>>;

export interface IpcOptions {
  trustedOrigin: string;
  allowInsecureLoopback: boolean;
}

/**
 * Builds the channel -> handler table. Every handler checks the sender, validates its arguments,
 * and always resolves with a BridgeResult: nothing throws across the IPC boundary and unknown
 * errors never leak their text.
 */
export function createHandlers(
  backend: SyncBackend,
  options: IpcOptions,
): Record<ChannelName, IpcHandler> {
  const guarded =
    (action: (...args: unknown[]) => Promise<unknown>): IpcHandler =>
    (sender, ...args) =>
      toBridgeResult(async () => {
        if (!isTrustedSender(sender, options.trustedOrigin)) {
          throw new ConfigError('Untrusted caller');
        }
        return action(...args);
      });

  return {
    [CHANNELS.getConfig]: guarded(async (...args) => {
      validateNoArgs(args);
      return backend.getConfigView();
    }),
    [CHANNELS.saveConfig]: guarded(async (...args) => {
      if (args.length !== 1) throw new ConfigError('Invalid arguments');
      return backend.saveConfig(validateSaveConfig(args[0], options));
    }),
    [CHANNELS.clearPassword]: guarded(async (...args) => {
      validateNoArgs(args);
      return backend.clearPassword();
    }),
    [CHANNELS.download]: guarded(async (...args) => {
      validateNoArgs(args);
      return backend.download();
    }),
    [CHANNELS.upload]: guarded(async (...args) => {
      if (args.length !== 2) throw new ConfigError('Invalid arguments');
      const { data, etag } = validateUploadArgs(args[0], args[1]);
      return backend.upload(data, etag);
    }),
  };
}
