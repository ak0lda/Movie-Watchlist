import { registerPlugin } from '@capacitor/core';
import type { ShareTargetPlugin } from './shareService';

/** The app's own native plugin (android/.../ShareTargetPlugin.java). */
export const ShareTarget = registerPlugin<ShareTargetPlugin>('ShareTarget');
