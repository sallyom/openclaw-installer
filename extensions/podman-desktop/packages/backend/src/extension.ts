import * as podmanDesktopAPI from '@podman-desktop/api';
import * as path from 'node:path';
import { RpcServer } from './rpc/setup.js';
import { registerAllHandlers } from './api-impl.js';
import { loadWebviewHtml } from './webview-utils.js';

export async function activate(extensionContext: podmanDesktopAPI.ExtensionContext): Promise<void> {
  console.log('OpenClaw extension activating...');

  const panel = podmanDesktopAPI.window.createWebviewPanel(
    'openclaw.launch',
    'OpenClaw',
    {},
  );

  const extensionPath = extensionContext.extensionUri.fsPath;
  const iconPath = podmanDesktopAPI.Uri.file(path.join(extensionPath, 'icon.png'));
  panel.iconPath = iconPath;

  loadWebviewHtml(panel, extensionPath);

  const rpcServer = new RpcServer(panel.webview);
  registerAllHandlers(rpcServer);

  const openCommand = podmanDesktopAPI.commands.registerCommand('openclaw.openPanel', () => {
    panel.reveal();
  });

  extensionContext.subscriptions.push(panel);
  extensionContext.subscriptions.push(openCommand);
}

export async function deactivate(): Promise<void> {
  console.log('OpenClaw extension deactivating...');
}
