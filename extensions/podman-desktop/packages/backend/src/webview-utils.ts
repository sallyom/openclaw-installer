import type { WebviewPanel } from '@podman-desktop/api';
import * as podmanDesktopAPI from '@podman-desktop/api';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function loadWebviewHtml(panel: WebviewPanel, extensionPath: string): void {
  const mediaPath = path.join(extensionPath, 'media');
  const indexHtmlPath = path.join(mediaPath, 'index.html');

  if (!fs.existsSync(indexHtmlPath)) {
    panel.webview.html = '<html><body><h1>OpenClaw</h1><p>Media files not found.</p></body></html>';
    return;
  }

  let html = fs.readFileSync(indexHtmlPath, 'utf-8');

  html = html.replace(/(<script[^>]+src=")([^"]+)(")/g, (_match, prefix, src, suffix) => {
    const uri = getWebviewUri(panel, mediaPath, src);
    return `${prefix}${uri}${suffix}`;
  });

  html = html.replace(/(<link[^>]+href=")([^"]+)(")/g, (_match, prefix, href, suffix) => {
    const uri = getWebviewUri(panel, mediaPath, href);
    return `${prefix}${uri}${suffix}`;
  });

  panel.webview.html = html;
}

function getWebviewUri(panel: WebviewPanel, mediaPath: string, relativePath: string): string {
  const cleanPath = relativePath.replace(/^\.?\//, '');
  const filePath = path.join(mediaPath, cleanPath);
  const uri = panel.webview.asWebviewUri(podmanDesktopAPI.Uri.file(filePath));
  return uri.toString();
}
