// @openthink/browser — Cloudflare Browser Rendering wrapper.
// Streams screenshots over WS at 4-6 fps, handles take-over handoff, persistent
// session DO. Iteration 5 fills this in. Iteration 1 ships the contract.

export interface BrowserSessionConfig {
  sessionId: string;
  region?: string;          // 'auto' | specific CF region
  viewport?: { width: number; height: number };
  fpsTarget?: number;       // default 5
  fpsThrottled?: number;    // when canvas hidden — default 1
  hibernateAfterMs?: number; // default 5 * 60_000
}

export interface BrowserAction {
  kind: 'navigate' | 'click' | 'type' | 'screenshot' | 'goBack' | 'goForward' | 'reload';
  target?: string;          // selector or URL
  text?: string;
  fullPage?: boolean;
}

export interface BrowserFrame {
  sessionId: string;
  ts: number;
  url: string;
  title: string;
  pngBase64: string;        // could swap to binary frame later
}
