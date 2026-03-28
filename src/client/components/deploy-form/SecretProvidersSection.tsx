import React from "react";
import type { DeployFormConfig } from "./types.js";

interface SecretProvidersSectionProps {
  config: DeployFormConfig;
  update: (field: string, value: string) => void;
}

export function SecretProvidersSection({ config, update }: SecretProvidersSectionProps) {
  return (
    <details style={{ marginTop: "1.5rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced: Experimental External Secret Providers</summary>
      <div className="card" style={{ marginTop: "0.75rem" }}>
        <div className="hint" style={{ marginBottom: "0.75rem" }}>
          Only use this if your secrets come from an external provider such as Vault, a mounted file,
          or a custom command. Most users should leave this closed and just enter credentials in the normal fields above.
        </div>
        <div className="form-group">
          <label>Secret Providers JSON (optional)</label>
          <textarea
            rows={6}
            placeholder={`{\n  "default": { "source": "env" },\n  "vault_openai": {\n    "source": "exec",\n    "command": "/usr/local/bin/vault",\n    "args": ["kv", "get", "-field=OPENAI_API_KEY", "secret/openclaw"],\n    "passEnv": ["VAULT_ADDR", "VAULT_TOKEN"]\n  }\n}`}
            value={config.secretsProvidersJson}
            onChange={(e) => update("secretsProvidersJson", e.target.value)}
          />
          <div className="hint">
            Optional <code>secrets.providers</code> object. Runtime prerequisites still need to exist
            inside the OpenClaw environment.
          </div>
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="form-row">
            <div className="form-group">
              <label>Anthropic SecretRef Source</label>
              <select
                value={config.anthropicApiKeyRefSource}
                onChange={(e) => update("anthropicApiKeyRefSource", e.target.value)}
              >
                <option value="env">env</option>
                <option value="file">file</option>
                <option value="exec">exec</option>
              </select>
            </div>
            <div className="form-group">
              <label>Anthropic SecretRef Provider</label>
              <input
                type="text"
                placeholder="default"
                value={config.anthropicApiKeyRefProvider}
                onChange={(e) => update("anthropicApiKeyRefProvider", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Anthropic SecretRef ID</label>
            <input
              type="text"
              placeholder="ANTHROPIC_API_KEY or /providers/anthropic/apiKey or providers/anthropic/apiKey"
              value={config.anthropicApiKeyRefId}
              onChange={(e) => update("anthropicApiKeyRefId", e.target.value)}
            />
            <div className="hint">
              Optional override. Leave blank to use the installer-managed env-backed SecretRef automatically.
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="form-row">
            <div className="form-group">
              <label>OpenAI SecretRef Source</label>
              <select
                value={config.openaiApiKeyRefSource}
                onChange={(e) => update("openaiApiKeyRefSource", e.target.value)}
              >
                <option value="env">env</option>
                <option value="file">file</option>
                <option value="exec">exec</option>
              </select>
            </div>
            <div className="form-group">
              <label>OpenAI SecretRef Provider</label>
              <input
                type="text"
                placeholder="default"
                value={config.openaiApiKeyRefProvider}
                onChange={(e) => update("openaiApiKeyRefProvider", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>OpenAI SecretRef ID</label>
            <input
              type="text"
              placeholder="OPENAI_API_KEY or /providers/openai/apiKey or providers/openai/apiKey"
              value={config.openaiApiKeyRefId}
              onChange={(e) => update("openaiApiKeyRefId", e.target.value)}
            />
            <div className="hint">
              Optional override. Leave blank to use the installer-managed env-backed SecretRef automatically.
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="form-row">
            <div className="form-group">
              <label>Telegram SecretRef Source</label>
              <select
                value={config.telegramBotTokenRefSource}
                onChange={(e) => update("telegramBotTokenRefSource", e.target.value)}
              >
                <option value="env">env</option>
                <option value="file">file</option>
                <option value="exec">exec</option>
              </select>
            </div>
            <div className="form-group">
              <label>Telegram SecretRef Provider</label>
              <input
                type="text"
                placeholder="default"
                value={config.telegramBotTokenRefProvider}
                onChange={(e) => update("telegramBotTokenRefProvider", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Telegram SecretRef ID</label>
            <input
              type="text"
              placeholder="TELEGRAM_BOT_TOKEN or /channels/telegram/botToken or channels/telegram/botToken"
              value={config.telegramBotTokenRefId}
              onChange={(e) => update("telegramBotTokenRefId", e.target.value)}
            />
            <div className="hint">
              Optional override. Leave blank to use the installer-managed env-backed SecretRef automatically.
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}
