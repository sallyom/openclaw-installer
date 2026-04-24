import type {
  RpcResponse,
  ProgressMessage,
  PlatformInfo,
  CodexAuthStatus,
  GcpDefaults,
  WorkspaceFiles,
  LaunchConfig,
  LaunchResult,
} from 'openclaw-podman-shared';
import { RPC_METHODS } from 'openclaw-podman-shared';

declare function acquirePodmanDesktopApi(): { postMessage(msg: unknown): void };
let pdApi: ReturnType<typeof acquirePodmanDesktopApi> | null = null;

function getApi() {
  if (!pdApi) {
    pdApi = acquirePodmanDesktopApi();
  }
  return pdApi;
}

export type ProgressHandler = (progress: ProgressMessage) => void;

class RpcClient {
  private messageId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private progressHandlers: ProgressHandler[] = [];

  constructor() {
    window.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.channel === 'deployProgress') {
        for (const handler of this.progressHandlers) {
          handler(msg as ProgressMessage);
        }
        return;
      }

      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        const response = msg as RpcResponse;
        if (response.error) {
          reject(new Error(`${response.error.code}: ${response.error.message}`));
        } else {
          resolve(response.result);
        }
      }
    });
  }

  onProgress(handler: ProgressHandler): () => void {
    this.progressHandlers.push(handler);
    return () => {
      this.progressHandlers = this.progressHandlers.filter(h => h !== handler);
    };
  }

  private call<T>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      const timeoutId = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 120000);
      this.pending.set(id, {
        resolve: (v: unknown) => { clearTimeout(timeoutId); resolve(v as T); },
        reject: (e: Error) => { clearTimeout(timeoutId); reject(e); },
      });
      getApi().postMessage({ id, method, params });
    });
  }

  getPlatformInfo(): Promise<PlatformInfo> {
    return this.call(RPC_METHODS.getPlatformInfo);
  }

  checkCodexAuth(): Promise<CodexAuthStatus> {
    return this.call(RPC_METHODS.checkCodexAuth);
  }

  detectGcpDefaults(): Promise<GcpDefaults> {
    return this.call(RPC_METHODS.detectGcpDefaults);
  }

  getDefaultWorkspaceFiles(): Promise<WorkspaceFiles> {
    return this.call(RPC_METHODS.getDefaultWorkspaceFiles);
  }

  launch(config: LaunchConfig): Promise<LaunchResult> {
    return this.call(RPC_METHODS.launch, config);
  }

  copyToClipboard(text: string): Promise<void> {
    return this.call(RPC_METHODS.copyToClipboard, { text });
  }
}

export const api = new RpcClient();
