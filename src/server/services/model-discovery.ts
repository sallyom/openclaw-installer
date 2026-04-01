import { createSign } from "node:crypto";
import type { ModelEndpointCatalogEntry } from "./model-endpoint.js";

export async function fetchAnthropicModels(apiKey: string): Promise<ModelEndpointCatalogEntry[]> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!response.ok) {
    throw new Error(`Anthropic API returned HTTP ${response.status}`);
  }
  const payload = await response.json() as { data?: Array<{ id: string; display_name?: string }> };
  const entries = Array.isArray(payload.data) ? payload.data : [];
  const models: ModelEndpointCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof entry.display_name === "string" && entry.display_name.trim()
      ? entry.display_name.trim()
      : id;
    models.push({ id, name });
  }
  return models;
}

// Keywords indicating non-chat models that aren't useful for agent inference
const OPENAI_EXCLUDE_PATTERNS = /\b(embedding|tts|whisper|dall-e|moderation|realtime|audio|search|babbage|davinci|canary|transcribe|instruct|image|sora)\b|^ft:/i;

// Models known not to work with OpenClaw (not in its model registry)
const OPENAI_EXCLUDE_MODELS = new Set([
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-0125",
  "gpt-3.5-turbo-1106",
  "gpt-3.5-turbo-16k",
  "gpt-4-0613",
  "computer-use-preview",
  "computer-use-preview-2025-03-11",
  "o1-2024-12-17",
  "o3-2025-04-16",
]);

// Date suffix pattern (e.g., -2024-08-06, -20250514)
const DATE_SUFFIX = /-\d{4}(-\d{2}(-\d{2})?)?$|-\d{8}$/;

export async function fetchOpenaiModels(apiKey: string): Promise<ModelEndpointCatalogEntry[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`OpenAI API returned HTTP ${response.status}`);
  }
  const payload = await response.json() as { data?: Array<{ id: string; owned_by?: string }> };
  const entries = Array.isArray(payload.data) ? payload.data : [];
  const models: ModelEndpointCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) continue;
    if (OPENAI_EXCLUDE_PATTERNS.test(id)) continue;
    if (OPENAI_EXCLUDE_MODELS.has(id)) continue;
    seen.add(id);
    models.push({ id, name: id });
  }
  // Sort: stable GPT first, stable non-GPT, dated GPT, dated non-GPT
  // Within each group, reverse alphabetical so newest models come first
  models.sort((a, b) => {
    const aHasDate = DATE_SUFFIX.test(a.id) ? 1 : 0;
    const bHasDate = DATE_SUFFIX.test(b.id) ? 1 : 0;
    const aIsGpt = a.id.startsWith("gpt-") ? 0 : 1;
    const bIsGpt = b.id.startsWith("gpt-") ? 0 : 1;
    const aBucket = aHasDate * 2 + aIsGpt;
    const bBucket = bHasDate * 2 + bIsGpt;
    if (aBucket !== bBucket) return aBucket - bBucket;
    return b.id.localeCompare(a.id); // reverse alpha within bucket
  });
  return models;
}

/**
 * Get an access token from a GCP Service Account JSON using the JWT grant flow.
 */
async function getAccessTokenFromSaJson(saJson: string): Promise<string> {
  const sa = JSON.parse(saJson) as {
    client_email?: string;
    private_key?: string;
    token_uri?: string;
    type?: string;
  };

  // For authorized_user credentials, use the refresh token flow
  if (sa.type === "authorized_user") {
    const au = sa as unknown as {
      client_id?: string;
      client_secret?: string;
      refresh_token?: string;
    };
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: au.client_id || "",
        client_secret: au.client_secret || "",
        refresh_token: au.refresh_token || "",
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) {
      throw new Error(`Token refresh failed: HTTP ${response.status}`);
    }
    const token = await response.json() as { access_token?: string };
    if (!token.access_token) throw new Error("No access_token in refresh response");
    return token.access_token;
  }

  // Service account: sign a JWT and exchange for an access token
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Invalid service account JSON: missing client_email or private_key");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(sa.private_key, "base64url");

  const jwt = `${header}.${payload}.${signature}`;

  const response = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: HTTP ${response.status}`);
  }
  const token = await response.json() as { access_token?: string };
  if (!token.access_token) throw new Error("No access_token in token response");
  return token.access_token;
}

/**
 * Fetch available models from Vertex AI for a given provider type.
 */
// Well-known Vertex AI models as a fallback when API discovery fails
const KNOWN_VERTEX_MODELS: Record<string, ModelEndpointCatalogEntry[]> = {
  anthropic: [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    { id: "claude-sonnet-4-5-20250514", name: "Claude Sonnet 4.5" },
  ],
  google: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  ],
};

export interface VertexModelsResult {
  models: ModelEndpointCatalogEntry[];
  warning?: string;
}

/**
 * Probe whether a model ID works on Vertex AI by sending a minimal request.
 */
async function probeVertexModel(
  accessToken: string,
  project: string,
  location: string,
  modelId: string,
): Promise<boolean> {
  try {
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/anthropic/models/${modelId}:rawPredict`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        anthropic_version: "vertex-2023-10-16",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchVertexModels(
  saJson: string,
  project: string,
  location: string,
  vertexProvider: string,
  anthropicApiKey?: string,
): Promise<VertexModelsResult> {
  const publisher = vertexProvider === "google" ? "google" : "anthropic";

  try {
    const accessToken = await getAccessTokenFromSaJson(saJson);

    // Query the Vertex AI Model Garden (v1beta1 publishers endpoint)
    const url = `https://${location}-aiplatform.googleapis.com/v1beta1/publishers/${publisher}/models`;

    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    // authorized_user credentials require a quota project header
    if (project) headers["x-goog-user-project"] = project;

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json() as {
      publisherModels?: Array<{
        name?: string;
        versionId?: string;
        openSourceCategory?: string;
      }>;
    };

    const entries = Array.isArray(payload.publisherModels) ? payload.publisherModels : [];
    const models: ModelEndpointCatalogEntry[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      // name is like "publishers/anthropic/models/claude-sonnet-4-6"
      const fullName = typeof entry.name === "string" ? entry.name : "";
      const id = fullName.split("/").pop() || "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push({ id, name: id });
    }

    if (models.length > 0) {
      models.sort((a, b) => a.id.localeCompare(b.id));
      return { models };
    }
  } catch {
    // Fall through to probe-based or curated list
  }

  // For Vertex Anthropic: if we have an Anthropic API key and GCP credentials,
  // fetch the Anthropic model list and probe each against Vertex in parallel
  if (publisher === "anthropic" && anthropicApiKey && saJson) {
    try {
      const [anthropicModels, accessToken] = await Promise.all([
        fetchAnthropicModels(anthropicApiKey),
        getAccessTokenFromSaJson(saJson),
      ]);

      // Probe ALL models in parallel to find which ones work on this user's Vertex
      const probeResults = await Promise.all(
        anthropicModels.map(async (m) => ({
          model: m,
          works: await probeVertexModel(accessToken, project, location, m.id),
        })),
      );

      const verified = probeResults.filter((r) => r.works).map((r) => r.model);

      if (verified.length > 0) {
        return { models: verified };
      }
    } catch {
      // Fall through to curated list
    }
  }

  // Return curated list when all discovery methods fail
  return {
    models: KNOWN_VERTEX_MODELS[publisher] || [],
    warning: "Unable to list available models. Showing common models. You can also type any model ID.",
  };
}
