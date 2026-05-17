import * as podmanDesktopAPI from '@podman-desktop/api';
import type { ContainerProviderConnection } from '@podman-desktop/api';

export interface PlatformContext {
  os: 'darwin' | 'linux' | 'win32';
  engineId: string;
  connection: ContainerProviderConnection;
}

let cachedContext: PlatformContext | null = null;

export async function getPlatformContext(): Promise<PlatformContext> {
  if (cachedContext) return cachedContext;

  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const connections = podmanDesktopAPI.provider.getContainerConnections();
  const podman = connections.find(c => c.connection.type === 'podman' && c.connection.status() === 'started');
  if (!podman) {
    throw new Error('No running Podman connection found. Is Podman running?');
  }

  const infos = await podmanDesktopAPI.containerEngine.listInfos({ provider: podman.connection });
  if (infos.length === 0) {
    throw new Error('Podman engine is not running. Please start Podman and try again.');
  }

  cachedContext = {
    os: platform,
    engineId: infos[0].engineId,
    connection: podman.connection,
  };

  return cachedContext;
}
