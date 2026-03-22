import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentSourceCronJobs } from "../agent-source.js";

const tempDirs: string[] = [];

describe("loadAgentSourceCronJobs", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures in tests.
      }
    }
  });

  it("loads cron/jobs.json from the agent source directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "cron"), { recursive: true });
    writeFileSync(join(dir, "cron", "jobs.json"), "{\"jobs\":[{\"name\":\"briefing\"}]}", "utf8");

    expect(loadAgentSourceCronJobs(dir)).toBe("{\"jobs\":[{\"name\":\"briefing\"}]}");
  });

  it("returns undefined when no cron/jobs.json exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);

    expect(loadAgentSourceCronJobs(dir)).toBeUndefined();
  });
});
