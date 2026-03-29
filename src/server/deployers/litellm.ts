import { randomBytes } from "node:crypto";
import type { DeployConfig } from "./types.js";

export const LITELLM_IMAGE = "ghcr.io/berriai/litellm:v1.82.3-stable.patch.2";
export const LITELLM_PORT = 4000;

export function generateLitellmMasterKey(): string {
  return `sk-litellm-${randomBytes(24).toString("hex")}`;
}

/**
 * Returns true when the LiteLLM proxy should be used for this config.
 * On by default when Vertex is enabled with SA JSON credentials.
 */
export function shouldUseLitellmProxy(config: DeployConfig): boolean {
  if (config.litellmProxy === false) return false;
  if (config.litellmProxy === true) return true;
  // Default: on when Vertex + SA JSON credentials are present
  return !!(config.vertexEnabled && config.gcpServiceAccountJson);
}

/**
 * Model name as registered in LiteLLM (no provider prefix).
 */
export function litellmModelName(config: DeployConfig): string {
  if (config.agentModel) return config.agentModel;
  return config.vertexProvider === "google"
    ? "gemini-2.5-pro"
    : "claude-sonnet-4-6";
}

/**
 * Full model string for OpenClaw config when using LiteLLM proxy.
 * Uses openai/ prefix so OpenClaw routes through the OpenAI-compatible client,
 * combined with MODEL_ENDPOINT pointing to LiteLLM.
 */
export function litellmModelString(config: DeployConfig): string {
  return `openai/${litellmModelName(config)}`;
}

/**
 * Build model entries for the LiteLLM config based on the Vertex provider.
 * LiteLLM only handles Vertex models — secondary providers (OpenAI, Anthropic)
 * are routed directly by the gateway using their native API keys.
 */
function buildModelList(config: DeployConfig): Array<Record<string, unknown>> {
  const project = config.googleCloudProject || "";
  const location = config.googleCloudLocation || "";

  const models: Array<Record<string, unknown>> = [];

  if (config.vertexProvider === "google") {
    models.push(
      {
        model_name: "gemini-2.5-pro",
        litellm_params: {
          model: "vertex_ai/gemini-2.5-pro",
          vertex_project: project,
          vertex_location: location,
        },
      },
      {
        model_name: "gemini-2.5-flash",
        litellm_params: {
          model: "vertex_ai/gemini-2.5-flash",
          vertex_project: project,
          vertex_location: location,
        },
      },
    );
  } else {
    // Anthropic (Claude via Vertex)
    models.push(
      {
        model_name: "claude-sonnet-4-6",
        litellm_params: {
          model: "vertex_ai/claude-sonnet-4-6",
          vertex_project: project,
          vertex_location: location,
        },
      },
      {
        model_name: "claude-haiku-4-5",
        litellm_params: {
          model: "vertex_ai/claude-haiku-4-5",
          vertex_project: project,
          vertex_location: location,
        },
      },
    );
  }

  return models;
}

/**
 * Generate litellm_config.yaml content as a YAML string.
 * We build it manually to avoid a js-yaml dependency.
 */
export function generateLitellmConfig(config: DeployConfig, masterKey: string): string {
  const models = buildModelList(config);

  // If the user specified a custom model, add it as an entry
  if (config.agentModel && !models.some((m) => m.model_name === config.agentModel)) {
    const project = config.googleCloudProject || "";
    const location = config.googleCloudLocation || "";
    models.unshift({
      model_name: config.agentModel,
      litellm_params: {
        model: `vertex_ai/${config.agentModel}`,
        vertex_project: project,
        vertex_location: location,
      },
    });
  }

  const lines: string[] = [
    "model_list:",
  ];

  for (const m of models) {
    const params = m.litellm_params as Record<string, string>;
    lines.push(`  - model_name: ${m.model_name}`);
    lines.push("    litellm_params:");
    lines.push(`      model: ${params.model}`);
    if (params.vertex_project !== undefined) {
      lines.push(`      vertex_project: "${params.vertex_project}"`);
      lines.push(`      vertex_location: "${params.vertex_location}"`);
    }
  }

  lines.push("");
  lines.push("general_settings:");
  lines.push(`  master_key: "${masterKey}"`);

  return lines.join("\n") + "\n";
}

/**
 * Returns all model names registered in LiteLLM (Vertex models only), so the
 * OpenClaw config can list them in the litellm provider's models array.
 */
export function litellmRegisteredModelNames(config: DeployConfig): string[] {
  return buildModelList(config).map((m) => String(m.model_name));
}
