import type { Webview } from '@podman-desktop/api';
import type { RpcRequest, RpcResponse, ProgressMessage } from 'openclaw-podman-shared';

export type RpcHandler = (params: unknown) => Promise<unknown>;

export class RpcServer {
  private handlers = new Map<string, RpcHandler>();
  private webview: Webview;

  constructor(webview: Webview) {
    this.webview = webview;
    webview.onDidReceiveMessage((message: unknown) => {
      this.handleMessage(message);
    });
  }

  registerMethod(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler);
  }

  sendProgress(progress: Omit<ProgressMessage, 'channel'>): void {
    const msg: ProgressMessage = { channel: 'deployProgress', ...progress };
    this.webview.postMessage(msg);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const msg = message as Record<string, unknown>;
    if (typeof msg.id === 'number' && typeof msg.method === 'string') {
      await this.handleRpcRequest(msg as unknown as RpcRequest);
    }
  }

  private async handleRpcRequest(request: RpcRequest): Promise<void> {
    const handler = this.handlers.get(request.method);

    if (!handler) {
      const response: RpcResponse = {
        id: request.id,
        error: { code: 'METHOD_NOT_FOUND', message: `Unknown method: ${request.method}` },
      };
      this.webview.postMessage(response);
      return;
    }

    try {
      const result = await handler(request.params);
      const response: RpcResponse = { id: request.id, result };
      this.webview.postMessage(response);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const response: RpcResponse = {
        id: request.id,
        error: { code: 'INTERNAL_ERROR', message: error.message },
      };
      this.webview.postMessage(response);
    }
  }
}
