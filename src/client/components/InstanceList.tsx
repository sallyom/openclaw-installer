import React, { useEffect, useState } from "react";

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

type ExpandedPanel = "token" | "command" | "logs" | null;

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

export default function InstanceList() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeK8s, setIncludeK8s] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, ExpandedPanel>>({});
  const [panelData, setPanelData] = useState<Record<string, string>>({});

  const fetchInstances = async () => {
    try {
      const res = await fetch(includeK8s ? "/api/instances?includeK8s=1" : "/api/instances");
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
    setLoading(true);
    fetchInstances();
    const interval = setInterval(fetchInstances, 5000);
    return () => clearInterval(interval);
  }, [includeK8s]);

  const k8sToggle = (
    <button className="btn btn-ghost" onClick={() => setIncludeK8s((prev) => !prev)}>
      {includeK8s ? "Hide Cluster" : "Show Cluster"}
    </button>
  );

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

    const endpoint = panel === "token" ? "token" : panel === "logs" ? "logs" : "command";
    try {
      const res = await fetch(`/api/instances/${id}/${endpoint}`);
      const data = await res.json();
      const value = panel === "token" ? data.token : panel === "logs" ? data.logs : data.command;
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
    const targetUrl = inst.url ? `${inst.url}?session=main` : inst.url;
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
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
          {k8sToggle}
        </div>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
          {k8sToggle}
        </div>
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
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
          {k8sToggle}
        </div>
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
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "1rem 1rem 0" }}>
        {k8sToggle}
      </div>
      {instances.map((inst) => {
        const isActing = acting === inst.id;
        const activePanel = expanded[inst.id];
        const panelContent = panelData[`${inst.id}-${activePanel}`];
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
                      onClick={() => togglePanel(inst.id, "token")}
                    >
                      {activePanel === "token" ? "Hide" : "Token"}
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
            <K8sProgress inst={inst} />
            {activePanel && panelContent && (
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
