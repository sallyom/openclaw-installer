import * as podmanDesktopAPI from '@podman-desktop/api';
import * as fs from 'node:fs';
import * as net from 'node:net';
import type { LaunchConfig, LaunchResult } from 'openclaw-podman-shared';
import type { RpcServer } from '../rpc/setup.js';
import { getPlatformContext } from './platform.js';
import { generateGatewayToken, generateLitellmMasterKey, buildGatewayEnvVars } from './credentials.js';
import { buildInitScript, volumeName, containerName, podName } from './volume-init.js';
import { needsPod, getSidecarDefs, getPodPortMappings } from './sidecars.js';

async function podman(args: string[]): Promise<podmanDesktopAPI.RunResult> {
  try {
    return await podmanDesktopAPI.process.exec('podman', args);
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string })?.stderr ?? '';
    const msg = (err as { message?: string })?.message ?? String(err);
    throw new Error(`podman ${args[0]} failed: ${stderr || msg}`);
  }
}

function checkPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(
      `Port ${port} is already in use. Choose a different gateway port or stop the existing deployment using that port.`
    )));
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve());
    });
  });
}

export async function deploy(config: LaunchConfig, rpcServer: RpcServer): Promise<LaunchResult> {
  const { connection } = await getPlatformContext();
  const volName = volumeName(config);
  const ctrName = containerName(config);
  const usePod = needsPod(config);
  const podNameStr = podName(config);

  const gatewayToken = generateGatewayToken();
  const litellmMasterKey = config.provider.type === 'vertex' ? generateLitellmMasterKey() : undefined;

  const sidecarDefs = getSidecarDefs(config, volName);
  let podCreated = false;

  try {
    // Step 0: Check port availability
    rpcServer.sendProgress({ step: 'checking-port', message: `Checking port ${config.agent.port}...`, complete: false });
    await checkPortAvailable(config.agent.port);
    if (config.provider.type === 'vertex') {
      await checkPortAvailable(config.agent.port + 1);
    }

    // Step 1: Pull images via API
    rpcServer.sendProgress({ step: 'pulling-images', message: `Pulling ${config.agent.image}...`, complete: false });
    const allImages = [config.agent.image];
    for (const s of sidecarDefs) {
      allImages.push(s.image);
    }
    for (const img of allImages) {
      rpcServer.sendProgress({ step: 'pulling-images', message: `Pulling ${img}...`, complete: false });
      await podmanDesktopAPI.containerEngine.pullImage(connection, img, () => {});
    }

    // Step 2: Create volume
    rpcServer.sendProgress({ step: 'creating-volume', message: `Creating volume ${volName}...`, complete: false });
    await podman(['volume', 'create', volName]);

    // Step 3: Provision volume via init container
    rpcServer.sendProgress({ step: 'provisioning', message: 'Provisioning volume...', complete: false });
    let saJsonContent: string | undefined;
    if (config.provider.type === 'vertex') {
      const saPath = config.provider.saJsonPath;
      if (!fs.existsSync(saPath)) {
        throw new Error(`GCP credentials file not found: ${saPath}`);
      }
      saJsonContent = fs.readFileSync(saPath, 'utf-8');
    }
    const initScript = buildInitScript(config, gatewayToken, litellmMasterKey, saJsonContent);

    await podman([
      'run', '--rm',
      '-v', `${volName}:/home/node/.openclaw`,
      config.agent.image,
      'sh', '-c', initScript,
    ]);

    // Step 4: Create pod if needed
    if (usePod) {
      rpcServer.sendProgress({ step: 'creating-pod', message: `Creating pod ${podNameStr}...`, complete: false });
      const portMappings = getPodPortMappings(config);
      const podArgs = ['pod', 'create', '--name', podNameStr];
      for (const pm of portMappings) {
        podArgs.push('-p', `${pm.hostPort}:${pm.containerPort}`);
      }
      await podman(podArgs);
      podCreated = true;
    }

    // Step 5: Create sidecar containers
    if (sidecarDefs.length > 0) {
      rpcServer.sendProgress({ step: 'starting-sidecars', message: 'Creating sidecar containers...', complete: false });
    }
    for (const sidecar of sidecarDefs) {
      rpcServer.sendProgress({ step: 'starting-sidecars', message: `Creating ${sidecar.name}...`, complete: false });

      const args = ['create', '--name', sidecar.name];

      if (usePod) {
        args.push('--pod', podNameStr);
      }

      if (sidecar.env) {
        for (const [k, v] of Object.entries(sidecar.env)) {
          args.push('-e', `${k}=${v}`);
        }
      }

      if (sidecar.volumeMount) {
        const ro = sidecar.volumeMount.readOnly ? ':ro' : '';
        args.push('-v', `${sidecar.volumeMount.source}:${sidecar.volumeMount.target}${ro}`);
      }

      args.push(sidecar.image);

      if (sidecar.cmd) {
        args.push(...sidecar.cmd);
      }

      await podman(args);
    }

    // Step 6: Create gateway container
    rpcServer.sendProgress({ step: 'starting-gateway', message: 'Creating gateway container...', complete: false });
    const gwEnv = buildGatewayEnvVars(config, litellmMasterKey);

    const gwArgs = [
      'create',
      '--name', ctrName,
      '--restart=unless-stopped',
      '--label', 'openclaw.managed=true',
      '--label', `openclaw.prefix=${config.agent.prefix}`,
      '--label', `openclaw.agent=${config.agent.name}`,
      '-v', `${volName}:/home/node/.openclaw`,
    ];

    if (config.agentSourceDir) {
      gwArgs.push('-v', `${config.agentSourceDir}:/tmp/agent-source:ro`);
    }

    for (const [k, v] of Object.entries(gwEnv)) {
      gwArgs.push('-e', `${k}=${v}`);
    }

    if (usePod) {
      gwArgs.push('--pod', podNameStr);
    } else {
      gwArgs.push('-p', `${config.agent.port}:18789`);
    }

    gwArgs.push(
      config.agent.image,
      'sh', '-c', 'umask 007 && exec node dist/index.js gateway --bind lan --port 18789',
    );

    const gwResult = await podman(gwArgs);
    const containerId = gwResult.stdout.trim();

    // Step 7: Start pod or standalone container
    rpcServer.sendProgress({ step: 'starting', message: 'Starting OpenClaw...', complete: false });
    if (usePod) {
      await podman(['pod', 'start', podNameStr]);
    } else {
      await podman(['start', containerId]);
    }

    // Step 8: Done
    rpcServer.sendProgress({ step: 'done', message: 'OpenClaw is running', complete: true });

    return {
      gatewayUrl: `http://localhost:${config.agent.port}`,
      gatewayToken,
      containerId,
      podId: usePod ? podNameStr : undefined,
    };
  } catch (err) {
    rpcServer.sendProgress({ step: 'error', message: `Deploy failed: ${err instanceof Error ? err.message : String(err)}`, complete: false, error: String(err) });
    try { await podman(['rm', '-f', ctrName]); } catch { /* ignore */ }
    for (const s of sidecarDefs) {
      try { await podman(['rm', '-f', s.name]); } catch { /* ignore */ }
    }
    if (podCreated) {
      try { await podman(['pod', 'rm', '-f', podNameStr]); } catch { /* ignore */ }
    }
    try { await podman(['volume', 'rm', volName]); } catch { /* ignore */ }
    throw err;
  }
}
