import React from "react";
import { createRoot } from "react-dom/client";
import { CmdTaskStatus } from "@/components/tt/cmd/task-status";
import { RfpStageBadge } from "@/components/tt/rfps/stage-badge";
import { BOARD_STATUSES } from "@/domain/cmd-tasks";
import { stages } from "@/domain/rfps";
import "@/styles.css";
// Both production stylesheets intentionally coexist to exercise the former collision.
import "@/components/tt/home/approved-home.css";
import "@/components/tt/rfps/workspace.css";

createRoot(document.getElementById("root")!).render(
  <main className="cmd-page" style={{ background: "#f1f6ff", minHeight: "100vh" }}>
    <h1>CMD status treatments · fictional preview</h1>
    <section style={{ background: "white", borderRadius: 16, padding: 24, marginTop: 24 }}>
      <h2>Today’s priorities</h2>
      <div className="cmd-priority-copy" style={{ marginTop: 16 }}>
        <span className="cmd-home-task-status"><CmdTaskStatus status="needs_approval" /></span>
        <h3>Review the next step</h3>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
        {BOARD_STATUSES.map(status => <CmdTaskStatus key={status} status={status} />)}
      </div>
    </section>
    <section style={{ background: "white", borderRadius: 16, padding: 24, marginTop: 24 }}>
      <h2>RFP stages</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 }}>
        {stages.map(stage => <RfpStageBadge key={stage} stage={stage} />)}
      </div>
    </section>
  </main>,
);
