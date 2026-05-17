import type { LaunchConfig } from 'openclaw-podman-shared';
import { containerName } from './volume-init.js';

export const LITELLM_IMAGE = 'ghcr.io/berriai/litellm:v1.82.3-stable.patch.2';
export const LITELLM_PORT = 4000;

export const OTEL_COLLECTOR_IMAGE = 'ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:0.120.0';
export const OTEL_GRPC_PORT = 4317;
export const OTEL_HTTP_PORT = 4318;

export const JAEGER_IMAGE = 'jaegertracing/jaeger:2.16.0';
export const JAEGER_UI_PORT = 16686;

export const CHROMIUM_IMAGE = 'chromedp/headless-shell:stable';
export const CHROMIUM_CDP_PORT = 9222;

export function litellmContainerName(config: LaunchConfig): string {
  return `${containerName(config)}-litellm`;
}

export function otelContainerName(config: LaunchConfig): string {
  return `${containerName(config)}-otel`;
}

export function jaegerContainerName(config: LaunchConfig): string {
  return `${containerName(config)}-jaeger`;
}

export function chromiumContainerName(config: LaunchConfig): string {
  return `${containerName(config)}-chromium`;
}

export function needsPod(config: LaunchConfig): boolean {
  return config.provider.type === 'vertex'
    || !!config.observability?.enabled
    || !!config.chromium?.enabled;
}

export interface SidecarDef {
  name: string;
  image: string;
  cmd?: string[];
  env?: Record<string, string>;
  volumeMount?: { source: string; target: string; readOnly?: boolean };
}

export function getSidecarDefs(config: LaunchConfig, volumeNameStr: string): SidecarDef[] {
  const sidecars: SidecarDef[] = [];

  if (config.provider.type === 'vertex') {
    sidecars.push({
      name: litellmContainerName(config),
      image: LITELLM_IMAGE,
      cmd: ['--config', '/home/node/.openclaw/litellm/config.yaml', '--port', '4000'],
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: '/home/node/.openclaw/gcp/sa.json',
      },
      volumeMount: { source: volumeNameStr, target: '/home/node/.openclaw' },
    });
  }

  if (config.observability?.enabled) {
    sidecars.push({
      name: otelContainerName(config),
      image: OTEL_COLLECTOR_IMAGE,
    });

    if (config.observability.jaeger) {
      sidecars.push({
        name: jaegerContainerName(config),
        image: JAEGER_IMAGE,
        env: { COLLECTOR_OTLP_ENABLED: 'true' },
      });
    }
  }

  if (config.chromium?.enabled) {
    sidecars.push({
      name: chromiumContainerName(config),
      image: CHROMIUM_IMAGE,
    });
  }

  return sidecars;
}

export function getPodPortMappings(config: LaunchConfig): Array<{ hostPort: number; containerPort: number }> {
  const mappings: Array<{ hostPort: number; containerPort: number }> = [
    { hostPort: config.agent.port, containerPort: 18789 },
  ];

  if (config.provider.type === 'vertex') {
    mappings.push({ hostPort: config.agent.port + 1, containerPort: LITELLM_PORT });
  }

  if (config.observability?.enabled) {
    mappings.push({ hostPort: OTEL_GRPC_PORT, containerPort: OTEL_GRPC_PORT });
    mappings.push({ hostPort: OTEL_HTTP_PORT, containerPort: OTEL_HTTP_PORT });

    if (config.observability.jaeger) {
      mappings.push({ hostPort: JAEGER_UI_PORT, containerPort: JAEGER_UI_PORT });
    }
  }

  if (config.chromium?.enabled) {
    mappings.push({ hostPort: CHROMIUM_CDP_PORT, containerPort: CHROMIUM_CDP_PORT });
  }

  return mappings;
}
