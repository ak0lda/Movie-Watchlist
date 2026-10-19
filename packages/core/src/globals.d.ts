// Core compiles without DOM or Node typings; URL exists at runtime in browsers, WebViews, Electron
// and Node. This declares only the part core uses. It is intentionally NOT imported by other
// packages, whose own typings (DOM or Node) provide URL.
declare class URL {
  constructor(input: string, base?: string);
  readonly protocol: string;
  readonly hostname: string;
  readonly username: string;
  readonly password: string;
  readonly search: string;
  readonly hash: string;
  readonly origin: string;
  readonly pathname: string;
}
