import React from "react";
import type { Dispatch, SetStateAction } from "react";
import type { DeployFormConfig } from "./types.js";

interface SandboxSectionProps {
  config: DeployFormConfig;
  update: (field: string, value: string) => void;
  setConfig: Dispatch<SetStateAction<DeployFormConfig>>;
}

export function SandboxSection({ config, update, setConfig }: SandboxSectionProps) {
  return (
    <>
      <h3 style={{ marginTop: "1.5rem" }}>Sandbox</h3>

      <div className="form-group">
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={config.sandboxEnabled}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, sandboxEnabled: e.target.checked }))
            }
          />
          Enable SSH sandbox backend
        </label>
        <div className="hint">
          Recommended path for this installer on both local containers and Kubernetes.
        </div>
      </div>

      {config.sandboxEnabled && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label>Sandbox Mode</label>
              <select
                value={config.sandboxMode}
                onChange={(e) => update("sandboxMode", e.target.value)}
              >
                <option value="all">all</option>
                <option value="non-main">non-main</option>
                <option value="off">off</option>
              </select>
            </div>
            <div className="form-group">
              <label>Sandbox Scope</label>
              <select
                value={config.sandboxScope}
                onChange={(e) => update("sandboxScope", e.target.value)}
              >
                <option value="session">session</option>
                <option value="agent">agent</option>
                <option value="shared">shared</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Workspace Access</label>
              <select
                value={config.sandboxWorkspaceAccess}
                onChange={(e) => update("sandboxWorkspaceAccess", e.target.value)}
              >
                <option value="rw">rw</option>
                <option value="ro">ro</option>
                <option value="none">none</option>
              </select>
            </div>
            <div className="form-group">
              <label>Remote Workspace Root</label>
              <input
                type="text"
                placeholder="/tmp/openclaw-sandboxes"
                value={config.sandboxSshWorkspaceRoot}
                onChange={(e) => update("sandboxSshWorkspaceRoot", e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={config.sandboxToolPolicyEnabled}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, sandboxToolPolicyEnabled: e.target.checked }))
                }
              />
              Customize sandbox tool baseline
            </label>
            <div className="hint">
              Optional persistent baseline for sandboxed tools. This is intentionally much smaller than the full gateway UI.
            </div>
          </div>

          {config.sandboxToolPolicyEnabled && (
            <div className="form-row" style={{ flexWrap: "wrap", gap: "1rem 1.5rem", marginBottom: "1rem" }}>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowFiles}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowFiles: e.target.checked }))
                  }
                />
                File tools
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowSessions}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowSessions: e.target.checked }))
                  }
                />
                Session tools
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowMemory}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowMemory: e.target.checked }))
                  }
                />
                Memory tools
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowRuntime}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowRuntime: e.target.checked }))
                  }
                />
                Runtime tools (`exec`, `bash`, `process`)
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowBrowser}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowBrowser: e.target.checked }))
                  }
                />
                Browser and canvas
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowAutomation}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowAutomation: e.target.checked }))
                  }
                />
                Automation tools
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowMessaging}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowMessaging: e.target.checked }))
                  }
                />
                Messaging tools
              </label>
            </div>
          )}

          <div className="form-group">
            <label>SSH Target</label>
            <input
              type="text"
              placeholder="user@gateway-host:22"
              value={config.sandboxSshTarget}
              onChange={(e) => update("sandboxSshTarget", e.target.value)}
            />
            <div className="hint">
              Required. OpenClaw will run sandboxed tools on this remote host.
            </div>
          </div>

          <div className="form-row">
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={config.sandboxSshStrictHostKeyChecking}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sandboxSshStrictHostKeyChecking: e.target.checked,
                  }))}
              />
              Strict host key checking
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={config.sandboxSshUpdateHostKeys}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sandboxSshUpdateHostKeys: e.target.checked,
                  }))}
              />
              Update host keys
            </label>
          </div>

          <div className="form-group">
            <label>SSH Private Key</label>
            <input
              type="text"
              placeholder="/path/to/id_ed25519"
              value={config.sandboxSshIdentityPath}
              onChange={(e) => update("sandboxSshIdentityPath", e.target.value)}
            />
            <div className="hint">Path on the installer host to the private key file.</div>
          </div>

          <div className="form-group">
            <label>
              SSH Certificate
              <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>
                {" "}(optional)
              </span>
            </label>
            <input
              type="text"
              placeholder="/path/to/id_ed25519-cert.pub"
              value={config.sandboxSshCertificatePath}
              onChange={(e) => update("sandboxSshCertificatePath", e.target.value)}
              style={{ marginBottom: "0.5rem" }}
            />
            <textarea
              rows={4}
              placeholder="ssh-ed25519-cert-v01@openssh.com ..."
              value={config.sandboxSshCertificate}
              onChange={(e) => update("sandboxSshCertificate", e.target.value)}
            />
            <div className="hint">Type a path on the installer host, or paste the certificate directly.</div>
          </div>

          <div className="form-group">
            <label>
              Known Hosts
              <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>
                {" "}(optional)
              </span>
            </label>
            <input
              type="text"
              placeholder="/path/to/known_hosts"
              value={config.sandboxSshKnownHostsPath}
              onChange={(e) => update("sandboxSshKnownHostsPath", e.target.value)}
              style={{ marginBottom: "0.5rem" }}
            />
            <textarea
              rows={4}
              placeholder="gateway-host ssh-ed25519 AAAA..."
              value={config.sandboxSshKnownHosts}
              onChange={(e) => update("sandboxSshKnownHosts", e.target.value)}
            />
            <div className="hint">Type a path on the installer host, or paste known_hosts entries directly.</div>
          </div>
        </>
      )}
    </>
  );
}
