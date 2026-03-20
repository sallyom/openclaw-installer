import React, { useState } from "react";
import DeployForm from "./components/DeployForm";
import InstanceList from "./components/InstanceList";
import LogStream from "./components/LogStream";

type Tab = "deploy" | "instances";

export default function App() {
  const [tab, setTab] = useState<Tab>("deploy");
  const [activeDeployId, setActiveDeployId] = useState<string | null>(null);

  return (
    <div className="app">
      <div className="header">
        <h1>OpenClaw Installer</h1>
        <span className="version">v0.1.0</span>
      </div>

      <div className="tabs">
        <button
          className={`tab ${tab === "deploy" ? "active" : ""}`}
          onClick={() => setTab("deploy")}
        >
          Deploy
        </button>
        <button
          className={`tab ${tab === "instances" ? "active" : ""}`}
          onClick={() => setTab("instances")}
        >
          Instances
        </button>
      </div>

      <div style={{ display: tab === "deploy" ? "block" : "none" }}>
        <DeployForm
          onDeployStarted={(id) => {
            setActiveDeployId(id);
          }}
        />
        {activeDeployId && <LogStream deployId={activeDeployId} />}
      </div>

      <div style={{ display: tab === "instances" ? "block" : "none" }}>
        <InstanceList />
      </div>
    </div>
  );
}
