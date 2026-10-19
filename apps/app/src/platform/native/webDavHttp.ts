import { registerPlugin } from '@capacitor/core';

export interface WebDavHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface WebDavHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** The app's own native plugin (android/.../WebDavHttpPlugin.java): OkHttp, any WebDAV verb. */
export interface WebDavHttpPlugin {
  request(options: WebDavHttpRequest): Promise<WebDavHttpResponse>;
}

export const WebDavHttp = registerPlugin<WebDavHttpPlugin>('WebDavHttp');
