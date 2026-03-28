import type { InferenceProvider } from "./types.js";

export const MODE_ICONS: Record<string, string> = {
  local: "💻",
  kubernetes: "☸️",
  openshift: "☸️",
  ssh: "🖥️",
};

export const PROVIDER_OPTIONS: Array<{ id: InferenceProvider; label: string; desc: string }> = [
  { id: "anthropic", label: "Anthropic", desc: "Claude models via Anthropic API" },
  { id: "openai", label: "OpenAI", desc: "GPT models via OpenAI API" },
  { id: "vertex-anthropic", label: "Google Vertex AI (Claude)", desc: "Claude models via Google Cloud" },
  { id: "vertex-google", label: "Google Vertex AI (Gemini)", desc: "Gemini models via Google Cloud" },
  { id: "custom-endpoint", label: "Model Endpoint", desc: "OpenAI-compatible self-hosted model server" },
];

export const MODEL_DEFAULTS: Record<InferenceProvider, string> = {
  "anthropic": "claude-sonnet-4-6",
  "openai": "openai/gpt-5",
  "vertex-anthropic": "anthropic-vertex/claude-sonnet-4-6",
  "vertex-google": "google-vertex/gemini-2.5-pro",
  "custom-endpoint": "",
};

export const MODEL_HINTS: Record<InferenceProvider, string> = {
  "anthropic": "Examples: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5",
  "openai": "Examples: openai/gpt-5, openai/gpt-5.3",
  "vertex-anthropic": "Examples: anthropic-vertex/claude-sonnet-4-6, anthropic-vertex/claude-opus-4-6",
  "vertex-google": "Examples: google-vertex/gemini-2.5-pro, google-vertex/gemini-2.5-flash",
  "custom-endpoint": "Examples: mistral-small-24b-w8a8, mistral-medium-3.1-24b-instruct-2506",
};

export const PROXY_MODEL_HINTS: Record<string, string> = {
  "vertex-anthropic": "Examples: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5",
  "vertex-google": "Examples: gemini-2.5-pro, gemini-2.5-flash",
};
