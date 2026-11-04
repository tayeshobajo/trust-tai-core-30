import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { supabase, supabaseConfig } from "./client";
import { rfpService } from "@/data/supabase/rfps";
import { RfpWorkspace, emptySnapshot } from "@/components/tt/rfps/workspace";
import type { Snapshot } from "@/domain/rfps";
import "@/styles.css";
function Harness() {
  const [org, setOrg] = useState(""),
    [data, setData] = useState<Snapshot>(emptySnapshot),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [canWork, setCanWork] = useState(false);
  async function refresh() {
    const value = await rfpService(org).load();
    setData(value);
  }
  return (
    <main>
      <header style={{ padding: 24 }}>
        <h1>Isolated RFP staging test</h1>
        <p>
          Target: {supabaseConfig.url} · test accounts and synthetic documents only · no production
          fallback
        </p>
      </header>
      {!ready ? (
        <form
          style={{ padding: 24, display: "grid", gap: 16, maxWidth: 600 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const values = new FormData(e.currentTarget);
            try {
              const result = await supabase.auth.signInWithPassword({
                email: String(values.get("email")),
                password: String(values.get("password")),
              });
              if (result.error) throw result.error;
              const access = await supabase
                .from("rfp_access")
                .select("access_level")
                .eq("organization_id", org)
                .eq("scope_id", org);
              if (access.error) throw access.error;
              setCanWork(access.data.some((a) => a.access_level === "work"));
              await refresh();
              setReady(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Staging test could not start.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Existing staging test-account email
            <input name="email" type="email" required autoComplete="off" />
          </label>
          <label>
            Test-account password
            <input name="password" type="password" required autoComplete="off" />
          </label>
          <label>
            Synthetic organization UUID
            <input
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              required
              pattern="[0-9a-fA-F-]{36}"
            />
          </label>
          <button disabled={busy}>{busy ? "Connecting to staging…" : "Open test workspace"}</button>
          {error && <p role="alert">{error}</p>}
        </form>
      ) : (
        <>
          <button
            style={{ margin: 24 }}
            onClick={async () => {
              await supabase.auth.signOut({ scope: "local" });
              setReady(false);
              setData(emptySnapshot);
            }}
          >
            End test session
          </button>
          <RfpWorkspace data={data} canWork={canWork} service={rfpService(org)} refresh={refresh} />
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
