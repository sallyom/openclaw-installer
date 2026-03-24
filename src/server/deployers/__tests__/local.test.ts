import { describe, it, expect } from "vitest";
import { applyGatewayRuntimeConfig, shouldAlwaysPull } from "../local.js";

describe("shouldAlwaysPull", () => {
  it("returns true for :latest tag", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw:latest")).toBe(true);
  });

  it("returns true for image with no tag (implies :latest)", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw")).toBe(true);
  });

  it("returns true for simple image name with :latest", () => {
    expect(shouldAlwaysPull("nginx:latest")).toBe(true);
  });

  it("returns true for simple image name with no tag", () => {
    expect(shouldAlwaysPull("nginx")).toBe(true);
  });

  it("returns false for version-pinned tag", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw:v2026.3.11")).toBe(false);
  });

  it("returns false for semver tag", () => {
    expect(shouldAlwaysPull("nginx:1.25.3")).toBe(false);
  });

  it("returns false for sha-based tag", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw:abc123")).toBe(false);
  });

  it("returns false for custom tag", () => {
    expect(shouldAlwaysPull("myregistry.io/app:staging")).toBe(false);
  });

  it("returns false for digest reference", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw@sha256:abcdef1234567890")).toBe(false);
  });
});

describe("applyGatewayRuntimeConfig", () => {
  it("enables OpenAI-compatible HTTP endpoints while preserving gateway config", () => {
    const updated = applyGatewayRuntimeConfig({
      gateway: {
        mode: "local",
        auth: { mode: "token", token: "abc" },
        controlUi: { enabled: true },
      },
    }, 18789) as {
      gateway?: {
        auth?: { token?: string };
        controlUi?: { allowedOrigins?: string[] };
        http?: {
          endpoints?: {
            chatCompletions?: { enabled?: boolean };
            responses?: { enabled?: boolean };
          };
        };
      };
    };

    expect(updated.gateway?.auth?.token).toBe("abc");
    expect(updated.gateway?.http?.endpoints?.chatCompletions?.enabled).toBe(true);
    expect(updated.gateway?.http?.endpoints?.responses?.enabled).toBe(true);
    expect(updated.gateway?.controlUi?.allowedOrigins).toEqual([
      "http://localhost:18789",
      "http://127.0.0.1:18789",
    ]);
  });

  it("can disable OpenAI-compatible HTTP endpoints while preserving gateway config", () => {
    const updated = applyGatewayRuntimeConfig({
      gateway: {
        mode: "local",
        auth: { mode: "token", token: "abc" },
        controlUi: { enabled: true },
      },
    }, 18789, false) as {
      gateway?: {
        http?: {
          endpoints?: {
            chatCompletions?: { enabled?: boolean };
            responses?: { enabled?: boolean };
          };
        };
      };
    };

    expect(updated.gateway?.http?.endpoints?.chatCompletions?.enabled).toBe(false);
    expect(updated.gateway?.http?.endpoints?.responses?.enabled).toBe(false);
  });
});
