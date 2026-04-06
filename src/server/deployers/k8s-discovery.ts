import * as k8s from "@kubernetes/client-node";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { coreApi, appsApi } from "../services/k8s.js";
import { installerDataDir } from "../paths.js";

export interface K8sPodInfo {
  name: string;
  phase: string;          // Pending, Running, Succeeded, Failed, Unknown
  ready: boolean;
  restarts: number;
  containerStatus: string; // e.g. "Running", "ContainerCreating", "CrashLoopBackOff", "ImagePullBackOff"
  message: string;         // reason or message from waiting/terminated state
}

export interface K8sInstance {
  namespace: string;
  status: "running" | "stopped" | "deploying" | "error" | "unknown";
  prefix: string;
  agentName: string;
  image: string;
  url: string;
  replicas: number;
  readyReplicas: number;
  pods: K8sPodInfo[];
  statusDetail: string;   // human-readable progress line
}

export interface DiscoverK8sInstancesOptions {
  namespaces?: string[];
}

async function loadSavedNamespaces(): Promise<string[]> {
  try {
    const k8sDir = join(installerDataDir(), "k8s");
    const entries = await readdir(k8sDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function derivePodInfo(pod: k8s.V1Pod): K8sPodInfo {
  const cs = pod.status?.containerStatuses?.[0];
  let containerStatus = "Unknown";
  let message = "";

  if (cs) {
    if (cs.state?.running) {
      containerStatus = "Running";
    } else if (cs.state?.waiting) {
      containerStatus = cs.state.waiting.reason || "Waiting";
      message = cs.state.waiting.message || "";
    } else if (cs.state?.terminated) {
      containerStatus = cs.state.terminated.reason || "Terminated";
      message = cs.state.terminated.message || "";
    }
  } else {
    // No container status yet — check init containers
    const initCs = pod.status?.initContainerStatuses?.[0];
    if (initCs?.state?.running) {
      containerStatus = "InitRunning";
      message = `Init container: ${initCs.name}`;
    } else if (initCs?.state?.waiting) {
      containerStatus = initCs.state.waiting.reason || "InitWaiting";
      message = initCs.state.waiting.message || `Init container: ${initCs.name}`;
    } else if (initCs?.state?.terminated && initCs.state.terminated.exitCode !== 0) {
      containerStatus = "InitError";
      message = initCs.state.terminated.message || `Init container failed: ${initCs.name}`;
    }
  }

  return {
    name: pod.metadata?.name || "",
    phase: pod.status?.phase || "Unknown",
    ready: cs?.ready ?? false,
    restarts: cs?.restartCount ?? 0,
    containerStatus,
    message,
  };
}

export function deriveInstanceStatus(
  replicas: number,
  readyReplicas: number,
  pods: K8sPodInfo[],
): { status: K8sInstance["status"]; statusDetail: string } {
  if (replicas === 0) {
    return { status: "stopped", statusDetail: "Scaled to 0" };
  }

  if (pods.length === 0) {
    return { status: "deploying", statusDetail: "Waiting for pod..." };
  }

  const pod = pods[0];

  if (pod.ready && pod.containerStatus === "Running") {
    return { status: "running", statusDetail: `Ready (${readyReplicas}/${replicas})` };
  }

  // Error states
  const errorStates = ["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "InitError", "RunContainerError"];
  if (errorStates.includes(pod.containerStatus)) {
    const detail = pod.message
      ? `${pod.containerStatus}: ${pod.message}`
      : pod.containerStatus;
    return { status: "error", statusDetail: detail };
  }

  // In-progress states
  const progressMap: Record<string, string> = {
    ContainerCreating: "Creating container...",
    PodInitializing: "Initializing...",
    InitRunning: pod.message || "Running init container...",
    InitWaiting: pod.message || "Waiting for init container...",
    Pending: "Pending scheduling...",
    Waiting: "Waiting...",
  };

  const detail = progressMap[pod.containerStatus]
    || progressMap[pod.phase]
    || `${pod.phase} / ${pod.containerStatus}`;

  return { status: "deploying", statusDetail: detail };
}

export async function discoverK8sInstances(options: DiscoverK8sInstancesOptions = {}): Promise<K8sInstance[]> {
  const results: K8sInstance[] = [];
  try {
    const core = coreApi();
    const apps = appsApi();
    const namespaces = new Set((options.namespaces || []).filter(Boolean));

    for (const nsName of await loadSavedNamespaces()) {
      namespaces.add(nsName);
    }

    try {
      const nsList = await core.listNamespace({
        labelSelector: "app.kubernetes.io/managed-by=openclaw-installer",
      });
      for (const ns of nsList.items) {
        const nsName = ns.metadata?.name || "";
        if (nsName && ns.status?.phase !== "Terminating") {
          namespaces.add(nsName);
        }
      }
    } catch {
      // Namespace-scoped users may not be able to list namespaces cluster-wide.
    }

    for (const nsName of namespaces) {
      try {
        const dep = await apps.readNamespacedDeployment({ name: "openclaw", namespace: nsName });
        const labels = dep.metadata?.labels || {};
        const replicas = dep.spec?.replicas ?? 1;
        const readyReplicas = dep.status?.readyReplicas ?? 0;
        const image = dep.spec?.template?.spec?.containers?.[0]?.image || "";

        // Fetch pods for detailed status
        const podList = await core.listNamespacedPod({
          namespace: nsName,
          labelSelector: "app=openclaw",
        });
        const pods = podList.items.map(derivePodInfo);

        const { status, statusDetail } = deriveInstanceStatus(replicas, readyReplicas, pods);

        results.push({
          namespace: nsName,
          status,
          prefix: labels["openclaw.prefix"] || nsName.replace(/-openclaw$/, ""),
          agentName: labels["openclaw.agent"] || "agent",
          image,
          url: "",
          replicas,
          readyReplicas,
          pods,
          statusDetail,
        });
      } catch {
        // Ignore stale saved namespaces and inaccessible targets.
      }
    }
  } catch {
    // Can't reach cluster or no permissions
  }
  return results;
}
