import React, { useEffect, useState } from "react";

interface PluginInfo {
  mode: string;
  title: string;
  description: string;
  source: string;
  enabled: boolean;
  available: boolean;
  builtIn: boolean;
  priority: number;
  supersededBy?: string;
}

interface PluginLoadError {
  pluginId: string;
  error: string;
}

const SOURCE_LABELS: Record<string, string> = {
  "built-in": "Built-in",
  "provider-plugin": "Installer Provider Plugin",
  "npm": "NPM Package",
  "config": "Custom",
};

const MODE_ICONS: Record<string, string> = {
  local: "\uD83D\uDCBB",
  kubernetes: "\u2638\uFE0F",
  openshift: "\u2638\uFE0F",
  ssh: "\uD83D\uDDA5\uFE0F",
};

export default function PluginList() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [errors, setErrors] = useState<PluginLoadError[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const fetchPlugins = () => {
    fetch("/api/plugins")
      .then((r) => r.json())
      .then((data) => {
        setPlugins(data.plugins || []);
        setErrors(data.errors || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPlugins();
  }, []);

  const handleToggle = async (mode: string, currentlyEnabled: boolean) => {
    setToggling(mode);
    try {
      const action = currentlyEnabled ? "disable" : "enable";
      const res = await fetch(`/api/plugins/${mode}/${action}`, { method: "POST" });
      if (res.ok) {
        fetchPlugins();
      }
    } catch {
      // ignore
    } finally {
      setToggling(null);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="empty-state">
          <p>Loading plugins...</p>
        </div>
      </div>
    );
  }

  const builtInPlugins = plugins.filter((p) => p.builtIn);
  const externalPlugins = plugins.filter((p) => !p.builtIn);

  return (
    <div>
      <div className="card">
        <h3>Registered Deployers</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
          Installer provider plugins provide deployment targets. Built-in deployers are always available.
          First-party and third-party installer provider plugins can be enabled or disabled.
        </p>

        {builtInPlugins.length > 0 && (
          <>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
              Built-in
            </div>
            {builtInPlugins.map((p) => (
              <PluginRow key={p.mode} plugin={p} toggling={toggling} onToggle={handleToggle} />
            ))}
          </>
        )}

        {externalPlugins.length > 0 && (
          <>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "1rem", marginBottom: "0.5rem" }}>
              Plugins
            </div>
            {externalPlugins.map((p) => (
              <PluginRow key={p.mode} plugin={p} toggling={toggling} onToggle={handleToggle} />
            ))}
          </>
        )}

        {plugins.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">{"\uD83D\uDD0C"}</div>
            <p>No deployers registered</p>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="card" style={{ borderColor: "rgba(248, 81, 73, 0.3)" }}>
          <button
            type="button"
            onClick={() => setShowErrors(!showErrors)}
            style={{
              background: "none",
              border: "none",
              color: "var(--danger)",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.9rem",
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span>{showErrors ? "\u25BC" : "\u25B6"}</span>
            {errors.length} plugin{errors.length !== 1 ? "s" : ""} failed to load
          </button>
          {showErrors && (
            <div style={{ marginTop: "0.75rem" }}>
              {errors.map((err) => (
                <div
                  key={err.pluginId}
                  style={{
                    padding: "0.5rem 0.75rem",
                    marginBottom: "0.5rem",
                    background: "rgba(248, 81, 73, 0.08)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.85rem",
                  }}
                >
                  <div style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                    {err.pluginId}
                  </div>
                  <div style={{ color: "var(--text-secondary)", marginTop: "0.25rem", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                    {err.error}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PluginRow({
  plugin,
  toggling,
  onToggle,
}: {
  plugin: PluginInfo;
  toggling: string | null;
  onToggle: (mode: string, enabled: boolean) => void;
}) {
  const isSuperseded = plugin.enabled && plugin.supersededBy;

  const statusColor = !plugin.enabled
    ? "var(--text-muted)"
    : isSuperseded
      ? "var(--text-muted)"
      : plugin.available
        ? "var(--success)"
        : "var(--warning)";

  const statusLabel = !plugin.enabled
    ? "Disabled"
    : isSuperseded
      ? "Superseded"
      : plugin.available
        ? "Active"
        : "Unavailable";

  return (
    <div className="instance-row">
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, opacity: plugin.enabled && !isSuperseded ? 1 : 0.55 }}>
        <div style={{ fontSize: "1.5rem", width: "2rem", textAlign: "center" }}>
          {MODE_ICONS[plugin.mode] || "\uD83D\uDD0C"}
        </div>
        <div className="instance-info">
          <div className="instance-name">
            {plugin.title}
            <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: "0.5rem", fontSize: "0.8rem" }}>
              {plugin.mode}
            </span>
          </div>
          <div className="instance-meta">
            {plugin.description}
            {isSuperseded && (
              <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                {" \u2022 "}Superseded by {plugin.supersededBy}
              </span>
            )}
            <span style={{ marginLeft: "0.5rem" }}>
              {" \u2022 "}
              <span style={{
                fontSize: "0.75rem",
                padding: "0.1rem 0.4rem",
                borderRadius: "99px",
                background: "rgba(139, 148, 158, 0.15)",
                color: "var(--text-secondary)",
              }}>
                {SOURCE_LABELS[plugin.source] || plugin.source}
              </span>
            </span>
          </div>
        </div>
      </div>
      <div className="instance-actions" style={{ alignItems: "center", gap: "0.75rem" }}>
        <span
          className={`badge ${!plugin.enabled ? "badge-stopped" : isSuperseded ? "badge-stopped" : plugin.available ? "badge-running" : "badge-deploying"}`}
          style={{ minWidth: "5rem", textAlign: "center" }}
        >
          <span style={{
            display: "inline-block",
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: statusColor,
            marginRight: "0.35rem",
          }} />
          {statusLabel}
        </span>
        {!plugin.builtIn && (
          <button
            className={`btn ${plugin.enabled ? "btn-ghost" : "btn-primary"}`}
            style={{ minWidth: "5rem", justifyContent: "center" }}
            disabled={toggling === plugin.mode}
            onClick={() => onToggle(plugin.mode, plugin.enabled)}
            aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.title} plugin`}
          >
            {toggling === plugin.mode ? "..." : plugin.enabled ? "Disable" : "Enable"}
          </button>
        )}
      </div>
    </div>
  );
}
