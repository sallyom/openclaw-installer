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

interface TokenizerCredMeta {
  name: string;
  allowedHosts: string[];
  headerDst?: string;
  headerFmt?: string;
}

interface Instance {
  id: string;
  mode: string;
  status: string;
  config: {
    prefix: string;
    agentName: string;
    agentDisplayName: string;
    tokenizerEnabled?: boolean;
    tokenizerCredentials?: Array<{ name: string; allowedHosts: string[]; secret?: string }>;
  };
  startedAt: string;
  url?: string;
  containerId?: string;
  error?: string;
  statusDetail?: string;
  pods?: PodInfo[];
}

interface CredentialDraft {
  key: string;
  name: string;
  secret: string;
  allowedHosts: string;
  headerDst: string;
  headerFmt: string;
  /** True for credentials loaded from the server (secret not editable). */
  existing?: boolean;
}

type ExpandedPanel = "connection" | "command" | "logs" | "credentials" | null;

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
  const [includeK8s, setIncludeK8s] = useState(false);
  const [k8sAvailable, setK8sAvailable] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, ExpandedPanel>>({});
  const [panelData, setPanelData] = useState<Record<string, string>>({});
  const [credDrafts, setCredDrafts] = useState<Record<string, CredentialDraft[]>>({});
  const [credUpdating, setCredUpdating] = useState<string | null>(null);

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
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: HealthResponse) => {
        setK8sAvailable(Boolean(data.k8sAvailable));
      })
      .catch(() => {
        setK8sAvailable(false);
        setIncludeK8s(false);
      });
  }, []);

  useEffect(() => {
    if (!k8sAvailable && includeK8s) {
      setIncludeK8s(false);
    }
  }, [k8sAvailable, includeK8s]);

  useEffect(() => {
    setLoading(true);
    fetchInstances();
    const interval = setInterval(fetchInstances, 5000);
    return () => clearInterval(interval);
  }, [includeK8s]);

  const k8sToggle = k8sAvailable ? (
    <button className="btn btn-ghost" onClick={() => setIncludeK8s((prev) => !prev)}>
      {includeK8s ? "Hide K8s" : "Include K8s"}
    </button>
  ) : null;

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

    if (panel === "credentials") {
      // Load current credential metadata from the API
      try {
        const res = await fetch(`/api/instances/${id}/tokenizer`);
        if (!res.ok) {
          alert("Failed to load credential metadata.");
          return;
        }
        const data = await res.json();
        const existing: CredentialDraft[] = (data.credentials || []).map((c: TokenizerCredMeta) => ({
          key: crypto.randomUUID(),
          name: c.name,
          secret: "",
          allowedHosts: c.allowedHosts.join(", "),
          headerDst: c.headerDst || "",
          headerFmt: c.headerFmt || "",
          existing: true,
        }));
        setCredDrafts((prev) => ({ ...prev, [id]: existing }));
        setExpanded((prev) => ({ ...prev, [id]: "credentials" }));
      } catch {
        alert("Could not connect to the API to load credentials.");
      }
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

  const handleUpdateCredentials = async (id: string) => {
    const drafts = credDrafts[id] || [];

    if (drafts.length === 0 && !confirm("This will remove all credentials. Continue?")) {
      return;
    }

    // Validate new credentials — existing ones are already validated server-side.
    const newDrafts = drafts.filter((d) => !d.existing);
    const incomplete = newDrafts.filter((d) => !d.name || !d.secret || !d.allowedHosts);
    if (incomplete.length > 0) {
      alert("Every new credential must have a name, secret, and at least one allowed host.");
      return;
    }

    const credentials = drafts.map((d) => ({
      name: d.name,
      secret: d.secret,
      allowedHosts: d.allowedHosts.split(",").map((h) => h.trim()).filter(Boolean),
      headerDst: d.headerDst || undefined,
      headerFmt: d.headerFmt || undefined,
    }));

    setCredUpdating(id);
    try {
      const res = await fetch(`/api/instances/${id}/tokenizer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials }),
      });
      if (!res.ok) {
        let errorMsg = res.statusText;
        try {
          const err = await res.json();
          errorMsg = err.error || errorMsg;
        } catch {
          // Response wasn't JSON — use statusText
        }
        alert(`Failed to update credentials: ${errorMsg}`);
      } else {
        setExpanded((prev) => ({ ...prev, [id]: null }));
        await fetchInstances();
      }
    } catch (err) {
      alert(`Failed to update credentials: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCredUpdating(null);
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
                    {inst.config.tokenizerEnabled && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => togglePanel(inst.id, "credentials")}
                      >
                        {activePanel === "credentials" ? "Hide" : "Credentials"}
                      </button>
                    )}
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
                  { label: "URL", value: `${inst.url}?session=main#token=${encodeURIComponent(panelContent)}` },
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
            {activePanel === "credentials" && (
              <div style={{ padding: "0 1rem 1rem" }}>
                <div style={{
                  padding: "0.75rem",
                  background: "rgba(52, 152, 219, 0.1)",
                  border: "1px solid rgba(52, 152, 219, 0.3)",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                  marginBottom: "0.75rem",
                }}>
                  Manage tokenizer credentials. Add new credentials or remove existing ones.
                  Changes require a restart which happens automatically.
                </div>

                {(credDrafts[inst.id] || []).map((cred, idx) => (
                  <div key={cred.key} style={{
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "0.5rem",
                    marginBottom: "0.5rem",
                  }}>
                    {cred.existing ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ flex: 1, fontSize: "0.85rem" }}>{cred.name}</span>
                        <button
                          className="btn btn-ghost"
                          aria-label={`Remove credential ${cred.name}`}
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                          onClick={() => {
                            setCredDrafts((prev) => ({
                              ...prev,
                              [inst.id]: (prev[inst.id] || []).filter((_, i) => i !== idx),
                            }));
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.25rem" }}>
                          <input
                            type="text"
                            name={`cred-name-${inst.id}-${idx}`}
                            aria-label={`Credential ${idx + 1} name`}
                            placeholder={"Name (e.g. github)\u2026"}
                            value={cred.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCredDrafts((prev) => {
                                const updated = [...(prev[inst.id] || [])];
                                updated[idx] = { ...updated[idx], name: val };
                                return { ...prev, [inst.id]: updated };
                              });
                            }}
                            style={{ flex: 1, padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
                          />
                          <button
                            className="btn btn-ghost"
                            aria-label={`Remove credential ${cred.name || idx + 1}`}
                            style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                            onClick={() => {
                              setCredDrafts((prev) => ({
                                ...prev,
                                [inst.id]: (prev[inst.id] || []).filter((_, i) => i !== idx),
                              }));
                            }}
                          >
                            Remove
                          </button>
                        </div>
                        <input
                          type="password"
                          name={`cred-secret-${inst.id}-${idx}`}
                          aria-label={`Credential ${cred.name || idx + 1} secret`}
                          autoComplete="new-password"
                          spellCheck={false}
                          placeholder={"API key or token\u2026"}
                          value={cred.secret}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCredDrafts((prev) => {
                              const updated = [...(prev[inst.id] || [])];
                              updated[idx] = { ...updated[idx], secret: val };
                              return { ...prev, [inst.id]: updated };
                            });
                          }}
                          style={{ width: "100%", padding: "0.25rem 0.5rem", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                        />
                        <input
                          type="text"
                          name={`cred-hosts-${inst.id}-${idx}`}
                          aria-label={`Credential ${cred.name || idx + 1} allowed hosts`}
                          placeholder={"Allowed hosts (e.g. api.github.com)\u2026"}
                          value={cred.allowedHosts}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCredDrafts((prev) => {
                              const updated = [...(prev[inst.id] || [])];
                              updated[idx] = { ...updated[idx], allowedHosts: val };
                              return { ...prev, [inst.id]: updated };
                            });
                          }}
                          style={{ width: "100%", padding: "0.25rem 0.5rem", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                        />
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <input
                            type="text"
                            name={`cred-header-dst-${inst.id}-${idx}`}
                            aria-label={`Credential ${cred.name || idx + 1} header name`}
                            placeholder={"Header name (default: Authorization)\u2026"}
                            value={cred.headerDst}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCredDrafts((prev) => {
                                const updated = [...(prev[inst.id] || [])];
                                updated[idx] = { ...updated[idx], headerDst: val };
                                return { ...prev, [inst.id]: updated };
                              });
                            }}
                            style={{ flex: 1, padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
                          />
                          <input
                            type="text"
                            name={`cred-header-fmt-${inst.id}-${idx}`}
                            aria-label={`Credential ${cred.name || idx + 1} header format`}
                            placeholder={"Header format (default: Bearer %s)\u2026"}
                            value={cred.headerFmt}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCredDrafts((prev) => {
                                const updated = [...(prev[inst.id] || [])];
                                updated[idx] = { ...updated[idx], headerFmt: val };
                                return { ...prev, [inst.id]: updated };
                              });
                            }}
                            style={{ flex: 1, padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                ))}

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    className="btn btn-ghost"
                    style={{ flex: 1 }}
                    onClick={() => {
                      setCredDrafts((prev) => ({
                        ...prev,
                        [inst.id]: [...(prev[inst.id] || []), { key: crypto.randomUUID(), name: "", secret: "", allowedHosts: "", headerDst: "", headerFmt: "" }],
                      }));
                    }}
                  >
                    + Add Credential
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={credUpdating === inst.id}
                    onClick={() => handleUpdateCredentials(inst.id)}
                  >
                    {credUpdating === inst.id ? "Applying\u2026" : "Apply Changes"}
                  </button>
                </div>
              </div>
            )}
            {activePanel && activePanel !== "connection" && activePanel !== "credentials" && panelContent && (
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
