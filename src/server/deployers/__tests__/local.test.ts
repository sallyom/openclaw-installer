import { describe, it, expect } from "vitest";
import {
  applyGatewayRuntimeConfig,
  parseContainerRunArgs,
  resolveLocalRuntimeModelEndpoint,
  shouldAlwaysPull,
} from "../local.js";

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

describe("resolveLocalRuntimeModelEndpoint", () => {
  it("rewrites localhost endpoints for podman containers", () => {
    expect(resolveLocalRuntimeModelEndpoint("http://localhost:8080/v1", "podman"))
      .toBe("http://host.containers.internal:8080/v1");
    expect(resolveLocalRuntimeModelEndpoint("http://127.0.0.1:8080/v1", "podman"))
      .toBe("http://host.containers.internal:8080/v1");
  });

  it("rewrites localhost endpoints for docker containers", () => {
    expect(resolveLocalRuntimeModelEndpoint("http://localhost:8080/v1", "docker"))
      .toBe("http://host.docker.internal:8080/v1");
  });

  it("leaves already-routable endpoints unchanged", () => {
    expect(resolveLocalRuntimeModelEndpoint("http://host.containers.internal:8080/v1", "podman"))
      .toBe("http://host.containers.internal:8080/v1");
    expect(resolveLocalRuntimeModelEndpoint("http://10.0.0.20:8080/v1", "podman"))
      .toBe("http://10.0.0.20:8080/v1");
  });
});

describe("parseContainerRunArgs", () => {
  it("parses quoted runtime args into argv tokens", () => {
    expect(
      parseContainerRunArgs("--userns=keep-id -v '/tmp/my data:/data:Z' --device /dev/kvm"),
    ).toEqual([
      "--userns=keep-id",
      "-v",
      "/tmp/my data:/data:Z",
      "--device",
      "/dev/kvm",
    ]);
  });

  it("rejects unterminated quotes", () => {
    expect(() => parseContainerRunArgs("--label 'broken")).toThrow("unterminated quote");
  });
});
