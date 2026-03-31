import * as k8s from "@kubernetes/client-node";
import { Writable } from "node:stream";

let _kc: k8s.KubeConfig | null = null;

/**
 * Load kubeconfig from default locations (~/.kube/config or in-cluster SA).
 * Cached after first call.
 */
export function loadKubeConfig(): k8s.KubeConfig {
  if (_kc) return _kc;
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  _kc = kc;
  return kc;
}

/** Reset cached config (useful if context changes). */
export function resetKubeConfig(): void {
  _kc = null;
}

export function coreApi(): k8s.CoreV1Api {
  return loadKubeConfig().makeApiClient(k8s.CoreV1Api);
}

export function appsApi(): k8s.AppsV1Api {
  return loadKubeConfig().makeApiClient(k8s.AppsV1Api);
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  status?: unknown;
}

export async function execInPod(
  namespace: string,
  podName: string,
  containerName: string,
  command: string[],
): Promise<ExecResult> {
  const kc = loadKubeConfig();
  const exec = new k8s.Exec(kc);

  let stdout = "";
  let stderr = "";
  let settled = false;

  const stdoutStream = new Writable({
    write(chunk, _encoding, callback) {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      callback();
    },
  });
  const stderrStream = new Writable({
    write(chunk, _encoding, callback) {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      callback();
    },
  });

  return await new Promise<ExecResult>((resolve, reject) => {
    void exec.exec(
      namespace,
      podName,
      containerName,
      command,
      stdoutStream,
      stderrStream,
      null,
      false,
      (status) => {
        if (settled) return;
        settled = true;
        const code = Number(
          (status as { details?: { causes?: Array<{ reason?: string; message?: string }> } })
            .details?.causes?.find((cause) => cause.reason === "ExitCode")?.message ?? "0",
        );
        if (code === 0) {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), status });
          return;
        }
        const errorText = [stdout, stderr].filter(Boolean).join("\n").trim()
          || `Pod exec failed with exit code ${code}`;
        reject(Object.assign(new Error(errorText), {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          status,
          exitCode: code,
        }));
      },
    ).then((ws) => {
      ws.onclose = () => {
        if (settled) return;
        settled = true;
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      };
      ws.onerror = (event) => {
        if (settled) return;
        settled = true;
        reject(new Error(`Pod exec websocket error: ${String(event)}`));
      };
    }).catch((err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * Check if we can connect to a K8s cluster AND the user is authenticated.
 *
 * The version endpoint (getCode) doesn't require authentication on most
 * clusters, so it can't detect `oc logout`. We follow up with a lightweight
 * authenticated call (SelfSubjectRulesReview) that fails after logout.
 */
export async function isClusterReachable(): Promise<boolean> {
  try {
    const kc = loadKubeConfig();

    // 1. Quick connectivity check — can we reach the API server at all?
    const versionClient = kc.makeApiClient(k8s.VersionApi);
    await versionClient.getCode();

    // 2. Authentication check — try a lightweight authn-required call.
    //    SelfSubjectRulesReview is available to every authenticated user and
    //    doesn't need list-namespace permissions.
    const authClient = kc.makeApiClient(k8s.AuthorizationV1Api);
    await authClient.createSelfSubjectRulesReview({
      body: {
        apiVersion: "authorization.k8s.io/v1",
        kind: "SelfSubjectRulesReview",
        spec: { namespace: "default" },
      },
    });
    return true;
  } catch (err) {
    // 401/403 from the auth check means the cluster is reachable but the
    // user is logged out or the token expired.
    // Connection-level errors (ECONNREFUSED, DNS) mean no cluster at all.
    // In both cases we return false — there is no usable cluster session.
    return false;
  }
}

/**
 * Check whether the OpenTelemetry Operator CRD is installed on the cluster.
 */
export async function hasOtelOperator(): Promise<boolean> {
  try {
    const client = loadKubeConfig().makeApiClient(k8s.ApiextensionsV1Api);
    await client.readCustomResourceDefinition({ name: "opentelemetrycollectors.opentelemetry.io" });
    return true;
  } catch {
    return false;
  }
}

export function currentContext(): string {
  try {
    const kc = loadKubeConfig();
    return kc.getCurrentContext();
  } catch {
    return "";
  }
}

export function currentNamespace(): string {
  try {
    const kc = loadKubeConfig();
    const ctxName = kc.getCurrentContext();
    if (!ctxName) return "";
    const ctx = kc.getContextObject(ctxName);
    const ns = ctx?.namespace?.trim();
    return ns || "";
  } catch {
    return "";
  }
}

export function k8sApiHttpCode(err: unknown): number | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "number" ? code : undefined;
  }
  if (err && typeof err === "object" && "cause" in err) {
    return k8sApiHttpCode((err as { cause: unknown }).cause);
  }
  return undefined;
}
