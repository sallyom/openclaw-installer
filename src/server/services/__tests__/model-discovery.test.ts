import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAnthropicModels, fetchOpenaiModels } from "../model-discovery.js";

describe("model-discovery", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("fetchAnthropicModels", () => {
    it("parses Anthropic model list response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
            { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
          ],
        }),
      });
      const models = await fetchAnthropicModels("sk-ant-test");
      expect(models).toHaveLength(2);
      expect(models[0]).toEqual({ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" });
      expect(models[1]).toEqual({ id: "claude-opus-4-6", name: "Claude Opus 4.6" });
    });

    it("deduplicates model IDs", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
            { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6 duplicate" },
          ],
        }),
      });
      const models = await fetchAnthropicModels("sk-ant-test");
      expect(models).toHaveLength(1);
    });

    it("throws on non-OK response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });
      await expect(fetchAnthropicModels("bad-key")).rejects.toThrow("Anthropic API returned HTTP 401");
    });

    it("sends correct headers", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });
      await fetchAnthropicModels("sk-ant-test");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-key": "sk-ant-test",
            "anthropic-version": "2023-06-01",
          }),
        }),
      );
    });
  });

  describe("fetchOpenaiModels", () => {
    it("parses OpenAI model list response and sorts", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "gpt-5.3", owned_by: "openai" },
            { id: "gpt-5", owned_by: "openai" },
          ],
        }),
      });
      const models = await fetchOpenaiModels("sk-test");
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe("gpt-5.3");
      expect(models[1].id).toBe("gpt-5");
    });

    it("sends Bearer auth header", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });
      await fetchOpenaiModels("sk-test");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer sk-test",
          }),
        }),
      );
    });

    it("throws on non-OK response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });
      await expect(fetchOpenaiModels("bad-key")).rejects.toThrow("OpenAI API returned HTTP 403");
    });

    it("deduplicates model IDs", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "gpt-5", owned_by: "openai" },
            { id: "gpt-5", owned_by: "openai" },
          ],
        }),
      });
      const models = await fetchOpenaiModels("sk-test");
      expect(models).toHaveLength(1);
    });
  });
});
