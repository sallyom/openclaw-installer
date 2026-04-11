import { Router } from "express";
import { registry } from "../deployers/registry.js";
import { createLogCallback, sendStatus } from "../ws.js";
import type { DeployResult } from "../deployers/types.js";
import { sanitizeDeployResult } from "../security.js";
import {
  findInstance,
  listInstances,
} from "./status-instances.js";
import {
  approveLatestDevicePairing,
  buildInstanceCommand,
  getGatewayToken,
  getInstanceLogs,
} from "./status-operations.js";

const router = Router();

export { parseSavedLocalInstanceConfig } from "./status-instances.js";

// List all instances: running containers + stopped local volumes + K8s
router.get("/", async (req, res) => {
  const includeK8s = req.query.includeK8s === "1";

  try {
    const instances = await listInstances(includeK8s);
    res.json(instances.map(sanitizeDeployResult));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Get single instance by container name
router.get("/:id", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  res.json(sanitizeDeployResult(instance));
});

// Start instance (re-creates the gateway container, volume has the state)
router.post("/:id/start", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = registry.get(instance.mode);
  if (!deployer) {
    res.status(400).json({ error: `No deployer registered for mode: ${instance.mode}` });
    return;
  }
  const log = createLogCallback(instance.id);
  try {
    await deployer.start(instance, log);
    sendStatus(instance.id, "running");
    res.json({ status: "running" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    res.status(500).json({ error: message });
  }
});

// Stop instance (volume stays)
router.post("/:id/stop", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = registry.get(instance.mode);
  if (!deployer) {
    res.status(400).json({ error: `No deployer registered for mode: ${instance.mode}` });
    return;
  }
  const log = createLogCallback(instance.id);
  await deployer.stop(instance, log);
  sendStatus(instance.id, "stopped");
  res.json({ status: "stopped" });
});

// Re-deploy: update agent files and restart (K8s: update ConfigMap + restart pod, Local: copy files + restart container)
router.post("/:id/redeploy", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = registry.get(instance.mode);
  if (!deployer) {
    res.status(400).json({ error: `No deployer registered for mode: ${instance.mode}` });
    return;
  }

  if (!("redeploy" in deployer) || typeof (deployer as unknown as Record<string, unknown>).redeploy !== "function") {
    res.status(400).json({ error: "Use Stop/Start for this deployer — redeploy is not supported" });
    return;
  }

  const log = createLogCallback(instance.id);
  try {
    await ((deployer as unknown as Record<string, unknown> & { redeploy: (r: DeployResult, l: typeof log) => Promise<void> }).redeploy(instance, log));
    sendStatus(instance.id, "running");
    res.json({ status: "redeploying" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    res.status(500).json({ error: message });
  }
});

// Approve the latest pending device pairing request for a running local instance.
router.post("/:id/approve-device", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  try {
    res.json(await approveLatestDevicePairing(instance));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get gateway token from running container or K8s secret
router.get("/:id/token", async (req, res) => {
  try {
    res.json({ token: await getGatewayToken(await findInstance(req.params.id), req.params.id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /No token found/.test(message) ? 404 : /must be running/.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

// Get the run command (podman/docker for local, kubectl for K8s)
router.get("/:id/command", async (req, res) => {
  try {
    res.json({ command: await buildInstanceCommand(await findInstance(req.params.id), req.params.id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /must be running/.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

// Get container/pod logs (last 50 lines)
router.get("/:id/logs", async (req, res) => {
  try {
    res.json({ logs: await getInstanceLogs(await findInstance(req.params.id), req.params.id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /must be running|No pods found/.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

// Delete data (remove volume or namespace — the nuclear option)
router.delete("/:id", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = registry.get(instance.mode);
  if (!deployer) {
    res.status(400).json({ error: `No deployer registered for mode: ${instance.mode}` });
    return;
  }
  const log = createLogCallback(instance.id);
  await deployer.teardown(instance, log);
  res.json({ status: "deleted" });
});

export default router;
