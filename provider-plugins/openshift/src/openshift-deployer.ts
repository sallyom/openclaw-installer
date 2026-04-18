import * as k8s from "@kubernetes/client-node";
import { KubernetesDeployer } from "../../../src/server/deployers/kubernetes.js";
import type {
  Deployer,
  DeployConfig,
  DeployResult,
  LogCallback,
} from "../../../src/server/deployers/types.js";
import { namespaceName } from "../../../src/server/deployers/k8s-helpers.js";
import { coreApi, appsApi, k8sApiHttpCode } from "../../../src/server/services/k8s.js";
import { oauthServiceAccount, oauthConfigSecret, oauthProxyContainer } from "./oauth-proxy.js";
import { applyRoute, getRouteUrl, deleteRoute } from "./route.js";

// ── Helper: apply or update a resource ─────────────────────────────

async function applyResource<T>(
  readFn: () => Promise<unknown>,
  createFn: () => Promise<T>,
  replaceFn: (() => Promise<T>) | null,
  name: string,
  log: LogCallback,
): Promise<void> {
  let exists = false;
  try {
    await readFn();
    exists = true;
  } catch {
    // does not exist
  }

  if (exists) {
    if (replaceFn) {
      log(`Updating ${name}...`);
      await replaceFn();
    } else {
      log(`${name} already exists (skipping)`);
      return;
    }
  } else {
    log(`Creating ${name}...`);
    await createFn();
  }
  log(`${name} applied`);
}

// ── OpenShift Deployer ─────────────────────────────────────────────

/**
 * OpenShiftDeployer wraps KubernetesDeployer, adding:
 * - ServiceAccount with OAuth redirect annotation
 * - OAuth config secret (SA token + cookie secret)
 * - Service with additional oauth-ui port and serving-cert annotation
 * - Route (TLS edge-terminated, targeting oauth-ui)
 * - Deployment patches: oauth-proxy sidecar, serviceAccountName, OAuth volumes
 * - OpenClaw config patched with routeUrl for allowedOrigins + disabled device auth
 *
 * BUG FIX vs claw-installer: teardown() now deletes the Route.
 *
 * Design note: KubernetesDeployer doesn't expose hooks for manifest customization,
 * so this deployer lets K8s deployer create base resources, then patches the
 * Service, Deployment, and ConfigMap with OpenShift additions. This avoids
 * replicating the full deploy logic while still adding all required OpenShift
 * resources.
 */
export class OpenShiftDeployer implements Deployer {
  private k8s = new KubernetesDeployer();

  async deploy(config: DeployConfig, log: LogCallback): Promise<DeployResult> {
    const ns = namespaceName(config);
    const core = coreApi();
    const apps = appsApi();

    log("OpenShift detected — deploying with OAuth proxy");

    // Phase 1: Create namespace (K8s deployer will skip if exists)
    // and OpenShift-specific pre-requisites
    try {
      await core.readNamespace({ name: ns });
    } catch (e: unknown) {
      const status = k8sApiHttpCode(e);
      if (status === 403) {
        log(`Cannot verify project "${ns}" at cluster scope (forbidden) — using it as the deploy target. Ensure it already exists and you have admin/edit there.`);
      } else if (status === 404) {
        log(`Creating namespace ${ns}...`);
        try {
          await core.createNamespace({
            body: {
              apiVersion: "v1",
              kind: "Namespace",
              metadata: { name: ns, labels: { "app.kubernetes.io/managed-by": "openclaw-installer" } },
            },
          });
          log(`Namespace ${ns} created`);
        } catch (createErr: unknown) {
          if (k8sApiHttpCode(createErr) === 403) {
            throw new Error(
              `Cannot create namespace "${ns}": forbidden. Create the project first (for example: oc new-project ${ns}) and set it in the deploy form, or ask a cluster admin.`,
              { cause: createErr },
            );
          }
          throw createErr;
        }
      } else {
        throw e;
      }
    }

    // ServiceAccount with OAuth redirect annotation
    const sa = oauthServiceAccount(ns);
    await applyResource(
      () => core.readNamespacedServiceAccount({ name: "openclaw-oauth-proxy", namespace: ns }),
      () => core.createNamespacedServiceAccount({ namespace: ns, body: sa }),
      () => core.replaceNamespacedServiceAccount({ name: "openclaw-oauth-proxy", namespace: ns, body: sa }),
      "ServiceAccount openclaw-oauth-proxy",
      log,
    );

    // OAuth config secret (client-secret + cookie_secret)
    const oauthSecret = await oauthConfigSecret(ns);
    await applyResource(
      () => core.readNamespacedSecret({ name: "openclaw-oauth-config", namespace: ns }),
      () => core.createNamespacedSecret({ namespace: ns, body: oauthSecret }),
      null, // Don't replace — keep existing secrets on re-deploy
      "Secret openclaw-oauth-config",
      log,
    );

    // Phase 2: Delegate to KubernetesDeployer for all base resources
    const result = await this.k8s.deploy(config, log);

    // Phase 3: Patch resources with OpenShift additions

    // 3a. Replace Service — add oauth-ui port and serving-cert annotation
    const svc: k8s.V1Service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: "openclaw",
        namespace: ns,
        labels: {
          app: "openclaw",
          ...(config.withA2a
            ? {
                "kagenti.io/type": "agent",
                "kagenti.io/protocol": "a2a",
                "app.kubernetes.io/name": "openclaw",
              }
            : {}),
        },
        annotations: {
          "service.beta.openshift.io/serving-cert-secret-name": "openclaw-proxy-tls",
          ...(config.withA2a ? { "kagenti.io/description": "OpenClaw AI Agent Gateway" } : {}),
        },
      },
      spec: {
        type: "ClusterIP",
        selector: { app: "openclaw" },
        ports: [
          ...(config.withA2a
            ? [{ name: "a2a", port: 8080, targetPort: "a2a" as unknown as k8s.IntOrString, protocol: "TCP" as const }]
            : []),
          { name: "gateway", port: 18789, targetPort: 18789 as unknown as k8s.IntOrString, protocol: "TCP" },
          ...(config.withA2a
            ? [{ name: "bridge", port: 18790, targetPort: 18790 as unknown as k8s.IntOrString, protocol: "TCP" as const }]
            : []),
          { name: "oauth-ui", port: 8443, targetPort: 8443 as unknown as k8s.IntOrString, protocol: "TCP" },
        ],
      },
    };
    log("Updating Service with OAuth proxy port...");
    await core.replaceNamespacedService({ name: "openclaw", namespace: ns, body: svc });
    log("Service openclaw updated for OpenShift");

    // 3b. Create Route (target oauth-ui port)
    await applyRoute(ns, log, true);
    const routeUrl = await getRouteUrl(ns);
    if (routeUrl) log(`Route URL: ${routeUrl}`);

    // 3c. Patch ConfigMap — update openclaw.json with routeUrl for allowedOrigins
    if (routeUrl) {
      try {
        const cmResult = await core.readNamespacedConfigMap({ name: "openclaw-config", namespace: ns });
        const existingData = cmResult.data || {};
        const configJson = existingData["openclaw.json"];
        if (configJson) {
          const parsed = JSON.parse(configJson);
          // Set allowedOrigins to include the Route URL
          if (parsed.gateway?.controlUi) {
            parsed.gateway.controlUi.allowedOrigins = [routeUrl];
          }
          // NOTE: we intentionally do NOT set gateway.trustedProxies here.
          // Setting trustedProxies to ["127.0.0.1", "::1"] causes the gateway
          // to treat agent subprocess connections as proxy connections (looks
          // for X-Forwarded-For headers that aren't there), which breaks
          // shouldAllowSilentLocalPairing and blocks subagent spawning (#69).
          // Without trustedProxies, the gateway logs a cosmetic warning about
          // "proxy headers from untrusted address". Browser pairing stays
          // enabled and can be approved from the Instances page. See
          // adr/0002-remove-trustedproxies-for-subagent-pairing.md for the
          // trustedProxies rationale.

          // Bind to loopback since OAuth proxy fronts the gateway
          if (parsed.gateway) {
            parsed.gateway.bind = "loopback";
          }
          const updatedCm: k8s.V1ConfigMap = {
            ...cmResult,
            data: { ...existingData, "openclaw.json": JSON.stringify(parsed) },
          };
          await core.replaceNamespacedConfigMap({ name: "openclaw-config", namespace: ns, body: updatedCm });
          log("ConfigMap openclaw-config updated with Route URL");
        }
      } catch {
        log("Warning: could not update ConfigMap with Route URL");
      }
    }

    // 3d. Patch Deployment — add oauth-proxy sidecar, serviceAccountName, volumes, loopback bind
    const oauthContainer = oauthProxyContainer(ns);
    const deployPatch = [
      // Add serviceAccountName
      { op: "add", path: "/spec/template/spec/serviceAccountName", value: "openclaw-oauth-proxy" },
      // Change gateway bind to loopback (OAuth proxy fronts it)
      {
        op: "replace",
        path: "/spec/template/spec/containers/0/command",
        value: [
          "sh", "-c",
          "umask 007 && exec node dist/index.js gateway run --bind loopback --port 18789",
        ],
      },
      // Add oauth-proxy container at the beginning
      { op: "add", path: "/spec/template/spec/containers/0", value: oauthContainer },
      // Add OAuth volumes
      {
        op: "add",
        path: "/spec/template/spec/volumes/-",
        value: { name: "oauth-config", secret: { secretName: "openclaw-oauth-config" } },
      },
      {
        op: "add",
        path: "/spec/template/spec/volumes/-",
        value: { name: "proxy-tls", secret: { secretName: "openclaw-proxy-tls" } },
      },
      // Force pod restart
      {
        op: "replace",
        path: "/spec/template/metadata/annotations/openclaw.io~1restart-at",
        value: new Date().toISOString(),
      },
    ];

    log("Patching Deployment with OAuth proxy sidecar...");
    await apps.patchNamespacedDeployment(
      { name: "openclaw", namespace: ns, body: deployPatch },
      k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.JsonPatch),
    );
    log("Deployment patched for OpenShift");

    // Update result with Route URL
    if (routeUrl) {
      log(`Open: ${routeUrl}`);
      log("Use the Open action from the Instances page to open with the saved token");
    }

    return {
      ...result,
      mode: "kubernetes", // Keep as kubernetes for compatibility
      url: routeUrl || result.url,
    };
  }

  async start(result: DeployResult, log: LogCallback): Promise<DeployResult> {
    return this.k8s.start(result, log);
  }

  async status(result: DeployResult): Promise<DeployResult> {
    const base = await this.k8s.status(result);
    // Enrich with Route URL if available
    const ns = result.config.namespace || result.containerId || "";
    if (ns) {
      const routeUrl = await getRouteUrl(ns);
      if (routeUrl) {
        return { ...base, url: routeUrl };
      }
    }
    return base;
  }

  async stop(result: DeployResult, log: LogCallback): Promise<void> {
    return this.k8s.stop(result, log);
  }

  async teardown(result: DeployResult, log: LogCallback): Promise<void> {
    const ns = result.config.namespace || result.containerId || "";
    const core = coreApi();

    // Delete OpenShift-specific resources before delegating to K8s teardown
    // BUG FIX: Route deletion was missing in claw-installer
    await deleteRoute(ns, log);

    // Delete OAuth-specific secrets
    for (const name of ["openclaw-oauth-config", "openclaw-proxy-tls"]) {
      try {
        await core.deleteNamespacedSecret({ name, namespace: ns });
        log(`Deleted Secret ${name}`);
      } catch {
        // may not exist
      }
    }

    // Delete ServiceAccount
    try {
      await core.deleteNamespacedServiceAccount({ name: "openclaw-oauth-proxy", namespace: ns });
      log("Deleted ServiceAccount openclaw-oauth-proxy");
    } catch {
      // may not exist
    }

    // Delegate remaining cleanup to KubernetesDeployer
    await this.k8s.teardown(result, log);
  }
}
