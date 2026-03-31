import React, { useEffect, useState } from "react";

interface HealthResponse {
  k8sAvailable?: boolean;
}

interface PodInfo {
  name: string;
  phase: string;
  ready: boolean;
  restarts: number;
  containerStatus: string;
  message: string;
}

interface Instance {
  id: string;
  mode: string;
  status: string;
  config: {
    prefix: string;
    agentName: string;
    agentDisplayName: string;
  };
  startedAt: string;
  url?: string;
  containerId?: string;
  error?: string;
  statusDetail?: string;
  pods?: PodInfo[];
}

type ExpandedPanel = "connection" | "command" | "logs" | null;

function defaultSessionKey(inst: Instance): string {
  const prefix = inst.config.prefix?.trim() || "openclaw";
  const agentName = inst.config.agentName?.trim();
  if (!agentName) {
    return "main";
  }
  return `agent:${prefix}_${agentName}:main`;
}

function StatusBadge({ inst, isActing }: { inst: Instance; isActing: boolean }) {
  const badgeColor: Record<string, string> = {
    running: "",
    stopped: "",
    deploying: "#f39c12",
    error: "#e74c3c",
    unknown: "",
  };
  const style = badgeColor[inst.status]
    ? { marginLeft: "0.5rem", background: badgeColor[inst.status], color: "#fff" }
    : { marginLeft: "0.5rem" };

  let label = inst.status;
  if (isActing) label = "...";
  else if (inst.status === "deploying") label = "deploying";
  else if (inst.status === "error") label = "error";

  return (
    <span className={`badge badge-${inst.status}`} style={style}>
      {label}
    </span>
  );
}

function K8sProgress({ inst }: { inst: Instance }) {
  if (inst.mode === "local") return null;
  if (!inst.statusDetail && (!inst.pods || inst.pods.length === 0)) return null;
  if (inst.status === "running") return null;

  const pod = inst.pods?.[0];

  return (
    <div
      style={{
        padding: "0.5rem 1rem",
        fontSize: "0.8rem",
        color: inst.status === "error" ? "#e74c3c" : "var(--text-secondary)",
        borderTop: "1px solid var(--border)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {inst.statusDetail && <span>{inst.statusDetail}</span>}
        {pod && pod.restarts > 0 && (
          <span style={{ color: "#e74c3c" }}>
            Restarts: {pod.restarts}
          </span>
        )}
      </div>
      {pod?.message && (
        <div style={{ marginTop: "0.25rem", opacity: 0.8, wordBreak: "break-word" }}>
          {pod.message}
        </div>
      )}
    </div>
  );
}

export default function InstanceList({ active }: { active: boolean }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [k8sAvailable, setK8sAvailable] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, ExpandedPanel>>({});
  const [panelData, setPanelData] = useState<Record<string, string>>({});
  const [pairingMessages, setPairingMessages] = useState<Record<string, { tone: "success" | "warning" | "error"; text: string }>>({});

  const fetchInstances = async () => {
    try {
      // Fix for #61: auto-include K8s instances when cluster is reachable
      const res = await fetch(k8sAvailable ? "/api/instances?includeK8s=1" : "/api/instances");
      if (!res.ok) {
        throw new Error(`Failed to load instances (${res.status})`);
      }
      const data = await res.json();
      setInstances(data);
      setError(null);
    } catch (err) {
      setInstances([]);
      setError(err instanceof Error ? err.message : "Failed to load instances");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: HealthResponse) => {
        setK8sAvailable(Boolean(data.k8sAvailable));
      })
      .catch(() => {
        setK8sAvailable(false);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchInstances();
    const interval = setInterval(fetchInstances, 5000);
    return () => clearInterval(interval);
  }, [k8sAvailable]);

  // Fix for #5: fetch immediately when the Instances tab becomes visible
  useEffect(() => {
    if (active) {
      fetchInstances();
    }
  }, [active]);

  const handleStart = async (id: string) => {
    setActing(id);
    await fetch(`/api/instances/${id}/start`, { method: "POST" });
    await fetchInstances();
    setActing(null);
  };

  const handleStop = async (id: string) => {
    setActing(id);
    await fetch(`/api/instances/${id}/stop`, { method: "POST" });
    setExpanded((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await fetchInstances();
    setActing(null);
  };

  const handleRedeploy = async (id: string) => {
    setActing(id);
    await fetch(`/api/instances/${id}/redeploy`, { method: "POST" });
    await fetchInstances();
    setActing(null);
  };

  const handleApproveDevice = async (id: string) => {
    setActing(id);
    setPairingMessages((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch(`/api/instances/${id}/approve-device`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.status === "noop") {
        setPairingMessages((prev) => ({
          ...prev,
          [id]: {
            tone: "warning",
            text: data.error || "No pending device pairing requests.",
          },
        }));
      } else if (res.ok) {
        setPairingMessages((prev) => ({
          ...prev,
          [id]: {
            tone: "success",
            text: "Approved the latest pending pairing request.",
          },
        }));
      } else {
        setPairingMessages((prev) => ({
          ...prev,
          [id]: {
            tone: "error",
            text: data.error || `Failed to approve pairing (${res.status})`,
          },
        }));
      }
    } catch (err) {
      setPairingMessages((prev) => ({
        ...prev,
        [id]: {
          tone: "error",
          text: err instanceof Error ? err.message : "Failed to approve pairing",
        },
      }));
    }
    await fetchInstances();
    setActing(null);
  };

  const handleDeleteData = async (id: string, mode?: string) => {
    if (
      !confirm(
        mode !== "local"
          ? "Delete namespace and all data? This removes the PVC, secrets, deployment, and namespace. Cannot be undone."
          : "Delete all data? This removes the data volume (config, sessions, workspaces). Cannot be undone.",
      )
    )
      return;
    setActing(id);
    await fetch(`/api/instances/${id}`, { method: "DELETE" });
    // Clean up UI state for the deleted instance
    setExpanded((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // Remove immediately from the list so it doesn't linger
    setInstances((prev) => prev.filter((i) => i.id !== id));
    setActing(null);
    // Still refresh to pick up any remaining state
    await fetchInstances();
  };

  const togglePanel = async (id: string, panel: ExpandedPanel) => {
    if (expanded[id] === panel) {
      setExpanded((prev) => ({ ...prev, [id]: null }));
      return;
    }

    const endpoint = panel === "connection" ? "token" : panel === "logs" ? "logs" : "command";
    try {
      const res = await fetch(`/api/instances/${id}/${endpoint}`);
      const data = await res.json();
      const value = panel === "connection" ? data.token : panel === "logs" ? data.logs : data.command;
      if (value) {
        setPanelData((prev) => ({ ...prev, [`${id}-${panel}`]: value }));
        setExpanded((prev) => ({ ...prev, [id]: panel }));
      }
    } catch {
      // ignore
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleOpenWithToken = async (inst: Instance) => {
    const targetUrl = inst.url ? `${inst.url}?session=${encodeURIComponent(defaultSessionKey(inst))}` : inst.url;
    try {
      const res = await fetch(`/api/instances/${inst.id}/token`);
      const data = await res.json();
      if (data.token) {
        window.open(`${targetUrl}#token=${encodeURIComponent(data.token)}`, "_blank", "noopener");
      }
    } catch {
      // Fall back to opening without token
      window.open(targetUrl, "_blank", "noopener");
    }
  };

  if (loading) {
    return (
      <div className="card">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <strong>Could not load instances.</strong>
        <div style={{ marginTop: "0.5rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          {error}
        </div>
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-icon">📦</div>
          <p>No OpenClaw instances found</p>
          <p style={{ fontSize: "0.85rem" }}>
            Deploy from the Deploy tab, or start a container manually — any
            container running an OpenClaw image will appear here automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--border)",
          background: "rgba(243, 156, 18, 0.08)",
          color: "var(--text-secondary)",
          fontSize: "0.9rem",
        }}
      >
        Browser access may require a one-time device pairing. If the Control UI asks to pair, use
        {" "}
        <strong>Approve Pairing</strong>
        {" "}
        on the running instance.
      </div>
      {instances.map((inst) => {
        const isActing = acting === inst.id;
        const activePanel = expanded[inst.id];
        const panelContent = panelData[`${inst.id}-${activePanel}`];
        const pairingMessage = pairingMessages[inst.id];
        const isRunning = inst.status === "running";
        const isStopped = inst.status === "stopped";
        const isDeploying = inst.status === "deploying";
        const isError = inst.status === "error";
        const isK8s = inst.mode !== "local";
        const canStop = isRunning || isDeploying || isError;
        // K8s: allow delete anytime (it deletes the whole namespace)
        // Local: must stop first
        const canDelete = isK8s || (!isRunning && !isDeploying);

        return (
          <div key={inst.id} style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="instance-row">
              <div className="instance-info">
                <div className="instance-name">
                  {inst.containerId || inst.id}
                  <StatusBadge inst={inst} isActing={isActing} />
                  {isK8s && (
                    <span
                      className="badge"
                      style={{ marginLeft: "0.25rem", background: "var(--accent)", color: "#fff", fontSize: "0.65rem" }}
                    >
                      {inst.mode === "openshift" ? "OpenShift" : "K8s"}
                    </span>
                  )}
                </div>
                <div className="instance-meta">
                  {inst.config.prefix && `${inst.config.prefix} · `}
                  {inst.config.agentName && `${inst.config.agentName} · `}
                  {isRunning && inst.url ? (
                    <a
                      href={inst.url}
                      target="_blank"
                      rel="noopener"
                      style={{ color: "var(--accent)" }}
                      onClick={(e) => {
                        e.preventDefault();
                        handleOpenWithToken(inst);
                      }}
                    >
                      {inst.url}
                    </a>
                  ) : isDeploying ? (
                    "deploying..."
                  ) : isError ? (
                    <span style={{ color: "#e74c3c" }}>
                      deployment error — check pod status
                    </span>
                  ) : (
                    isK8s ? "stopped — scaled to 0, PVC preserved" : "stopped — data volume preserved"
                  )}
                </div>
              </div>
              <div className="instance-actions">
                {isRunning && (
                  <>
                    <button
                      className="btn btn-ghost"
                      disabled={isActing}
                      onClick={() => handleApproveDevice(inst.id)}
                      title="Approve the latest pending browser device pairing request"
                    >
                      Approve Pairing
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => togglePanel(inst.id, "connection")}
                    >
                      {activePanel === "connection" ? "Hide" : "Connection Info"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => togglePanel(inst.id, "command")}
                    >
                      {activePanel === "command" ? "Hide" : "Command"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => togglePanel(inst.id, "logs")}
                    >
                      {activePanel === "logs" ? "Hide" : "Logs"}
                    </button>
                  </>
                )}
                {isK8s && (isRunning || isDeploying || isError) && (
                  <button
                    className="btn btn-ghost"
                    disabled={isActing}
                    onClick={() => handleRedeploy(inst.id)}
                    title="Update agent files from ~/.openclaw/ and restart pod"
                  >
                    Re-deploy
                  </button>
                )}
                {isStopped && (
                  <button
                    className="btn btn-primary"
                    disabled={isActing}
                    onClick={() => handleStart(inst.id)}
                    title={isK8s ? "Scale deployment to 1 replica" : "Start container"}
                  >
                    Start
                  </button>
                )}
                {canStop && (
                  <button
                    className="btn btn-ghost"
                    disabled={isActing}
                    onClick={() => handleStop(inst.id)}
                    title={isK8s ? "Scale deployment to 0 replicas (PVC preserved)" : "Stop container"}
                  >
                    Stop
                  </button>
                )}
                <button
                  className="btn btn-danger"
                  disabled={isActing || !canDelete}
                  onClick={() => handleDeleteData(inst.id, inst.mode)}
                  title={
                    !canDelete
                      ? "Stop the instance first"
                      : isK8s
                        ? "Delete namespace and all data"
                        : "Delete data volume (config, sessions, workspaces)"
                  }
                >
                  Delete Data
                </button>
              </div>
            </div>
            {pairingMessage && (
              <div
                style={{
                  padding: "0.5rem 1rem",
                  borderTop: "1px solid var(--border)",
                  color:
                    pairingMessage.tone === "success"
                      ? "#1f7a3d"
                      : pairingMessage.tone === "warning"
                        ? "#9a6700"
                        : "#e74c3c",
                  fontSize: "0.85rem",
                }}
              >
                {pairingMessage.text}
              </div>
            )}
            <K8sProgress inst={inst} />
            {activePanel === "connection" && panelContent && inst.url && (
              <div
                style={{
                  padding: "0 1rem 1rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                {[
                  {
                    label: "URL",
                    value: `${inst.url}?session=${encodeURIComponent(defaultSessionKey(inst))}#token=${encodeURIComponent(panelContent)}`,
                  },
                  { label: "Token", value: panelContent },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", minWidth: "3rem" }}>
                      {label}
                    </span>
                    <code
                      style={{
                        flex: 1,
                        padding: "0.35rem 0.75rem",
                        background: "var(--bg-primary)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.8rem",
                        color: "var(--text-secondary)",
                        wordBreak: "break-all",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {value}
                    </code>
                    <button
                      className="btn btn-ghost"
                      onClick={() => handleCopy(value)}
                    >
                      Copy
                    </button>
                  </div>
                ))}
              </div>
            )}
            {activePanel && activePanel !== "connection" && panelContent && (
              <div
                style={{
                  padding: "0 1rem 1rem",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                }}
              >
                <code
                  style={{
                    flex: 1,
                    padding: "0.5rem 0.75rem",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.8rem",
                    color: "var(--text-secondary)",
                    wordBreak: "break-all",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {panelContent}
                </code>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleCopy(panelContent)}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
