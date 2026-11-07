/** Genuine OpenCode candidate. Never substitutes the direct Coding Plan HTTP client. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, lstatSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { StringDecoder } from "node:string_decoder";
import {
  COORDINATOR,
  digest,
  profileSchema,
  type CliAccounting,
} from "./studio-research-coordinator-contracts";
import type { ExecutionInput } from "./studio-research-coordinator.server";
export const OPEN_CODE = {
  version: "1.17.13",
  path: "/Users/tayeshobajo/.npm-global/lib/node_modules/opencode-ai/bin/opencode.exe",
  sha256: "5124dfe29f6b4552a71a00d1b60427229c58576cb3e2bff5c884cd7c12d66bdb",
  maxInputBytes: 25000,
  maxOutputBytes: 150000,
  deadlineMs: 60000,
} as const;
const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
export function inspectOpenCode() {
  const stat = lstatSync(OPEN_CODE.path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o022) !== 0 ||
    hash(readFileSync(OPEN_CODE.path)) !== OPEN_CODE.sha256
  )
    throw Error("executable_unverified");
  return { version: OPEN_CODE.version, sha256: OPEN_CODE.sha256 };
}
export function openCodeIsolationStatus() {
  // Do not retry the denied macOS sandbox preflight. The Linux host binary and isolation profile have not been attested.
  return {
    available: false as const,
    reason:
      process.platform === "darwin"
        ? "macos_sandbox_apply_denied"
        : "host_executable_and_isolation_unverified",
  };
}
export type OpenCodeOutcome = {
  text: string;
  nativeSessionId: string;
  events: number;
  steps: number;
  providerRequests: null;
  accounting: CliAccounting;
  bindingDigest: string;
  immediateChildClosed: true;
};
export function parseOpenCodeEvents(
  stdout: string,
  bindingDigest: string,
): Omit<OpenCodeOutcome, "accounting" | "immediateChildClosed"> {
  if (Buffer.byteLength(stdout) > OPEN_CODE.maxOutputBytes) throw Error("output_limit");
  let nativeSessionId = "",
    text = "",
    steps = 0,
    events = 0,
    starts = 0;
  for (const line of stdout.split("\n").filter(Boolean)) {
    if (++events > 200) throw Error("event_limit");
    const e = z
      .object({
        type: z.string(),
        sessionID: z.string().min(1).max(200),
        part: z.record(z.unknown()).optional(),
      })
      .passthrough()
      .parse(JSON.parse(line));
    if (nativeSessionId && nativeSessionId !== e.sessionID) throw Error("session_changed");
    nativeSessionId = e.sessionID;
    if (!["step_start", "step_finish", "text", "reasoning"].includes(e.type))
      throw Error("unexpected_runtime_event");
    if (steps) throw Error("event_after_completion");
    if (e.type === "step_start") {
      if (++starts !== 1 || events !== 1) throw Error("step_order_invalid");
    } else if (starts !== 1) throw Error("step_missing");
    if (e.type === "step_finish") {
      steps++;
      if (steps > 1 || e.part?.["reason"] !== "stop") throw Error("unexpected_completion");
    }
    if (e.type === "text") {
      if (typeof e.part?.["text"] !== "string") throw Error("text_invalid");
      text += e.part["text"];
    }
  }
  if (!nativeSessionId || steps !== 1 || !text) throw Error("completion_missing");
  return {
    text,
    nativeSessionId,
    events,
    steps,
    providerRequests: null,
    bindingDigest,
  };
}
export function prepareOpenCode(
  input: ExecutionInput,
  syntheticKey: string,
  fixturePort: number,
  now = Date.now(),
) {
  profileSchema.parse(input.profile);
  for (const v of [input.requestId, input.issueId, input.runId]) z.string().uuid().parse(v);
  z.string()
    .regex(/^ses_[0-9a-f-]{36}$/)
    .parse(input.sessionId);
  if (
    input.signal.aborted ||
    now >= input.launchDeadline ||
    input.completionDeadline <= now ||
    input.completionDeadline - now > OPEN_CODE.deadlineMs ||
    Buffer.byteLength(input.prompt) > OPEN_CODE.maxInputBytes
  )
    throw Error("execution_invalid");
  if (
    !/^synthetic-[A-Za-z0-9-]{1,80}$/.test(syntheticKey) ||
    !Number.isInteger(fixturePort) ||
    fixturePort < 1024 ||
    fixturePort > 65535
  )
    throw Error("offline_fixture_required");
  const cwd = mkdtempSync(join(tmpdir(), "studio-opencode-"));
  for (const dir of ["home", "config", "data", "cache", "state", "tmp"])
    mkdirSync(join(cwd, dir), { mode: 0o700 });
  const binding = {
    requestId: input.requestId,
    issueId: input.issueId,
    runId: input.runId,
    sessionId: input.sessionId,
    nonce: input.nonce,
    promptDigest: hash(input.prompt),
    profileDigest: digest(input.profile),
  };
  // Configuration keys are statically present in installed 1.17.13; runtime enforcement is not yet established.
  const config = {
    model: COORDINATOR.model,
    small_model: COORDINATOR.model,
    enabled_providers: ["zai-coding-plan"],
    autoupdate: false,
    share: "disabled",
    snapshot: false,
    permission: { "*": "deny" },
    compaction: { auto: false, prune: false },
    mcp: {},
    plugin: [],
    instructions: [],
    skills: { paths: [], urls: [] },
    default_agent: "studio-research",
    agent: {
      "studio-research": {
        mode: "primary",
        model: COORDINATOR.model,
        permission: { "*": "deny" },
        steps: 1,
      },
      title: { disable: true },
      summary: { disable: true },
      compaction: { disable: true },
    },
    provider: {
      "zai-coding-plan": {
        npm: "@ai-sdk/openai-compatible",
        options: { apiKey: syntheticKey, baseURL: `http://127.0.0.1:${fixturePort}/v1` },
        models: { "glm-5.3": { name: "GLM 5.3", limit: { context: 32000, output: 2048 } } },
      },
    },
  };
  writeFileSync(join(cwd, "config", "opencode.json"), JSON.stringify(config), { mode: 0o600 });
  writeFileSync(join(cwd, "binding.json"), JSON.stringify(binding), { mode: 0o600 });
  const env = {
    HOME: join(cwd, "home"),
    XDG_CONFIG_HOME: join(cwd, "config"),
    XDG_DATA_HOME: join(cwd, "data"),
    XDG_CACHE_HOME: join(cwd, "cache"),
    XDG_STATE_HOME: join(cwd, "state"),
    TMPDIR: join(cwd, "tmp"),
    PATH: "/usr/bin:/bin",
    OPENCODE_CONFIG: join(cwd, "config", "opencode.json"),
    OPENCODE_CONFIG_DIR: join(cwd, "config"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_PERMISSION: '{"*":"deny"}',
  };
  const quote = (v: string) => JSON.stringify(v);
  const sandboxProfile = `(version 1) (deny default) (allow process-exec (literal ${quote(OPEN_CODE.path)})) (allow file-read* (literal ${quote(OPEN_CODE.path)}) (subpath "/System/Library") (subpath "/usr/lib") (subpath ${quote(cwd)})) (allow file-write* (subpath ${quote(cwd)})) (allow network-outbound (remote ip "127.0.0.1:${fixturePort}"))`;
  writeFileSync(join(cwd, "isolation.sb"), sandboxProfile, { mode: 0o600 });
  return {
    cwd,
    env,
    sandboxPath: join(cwd, "isolation.sb"),
    executable: OPEN_CODE.path,
    argv: [
      "run",
      "--format",
      "json",
      "--model",
      COORDINATOR.model,
      "--agent",
      "studio-research",
      "--title",
      `Studio ${input.requestId}`,
      "--dir",
      cwd,
    ],
    stdin: input.prompt,
    bindingDigest: digest(binding),
    completionDeadline: input.completionDeadline,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}
/** Real launch entrypoint stays closed on unavailable OS containment, not a caller assertion. */
export function startOpenCode(input: ExecutionInput, syntheticKey: string, fixturePort: number) {
  const isolation = openCodeIsolationStatus();
  // This verified denial is not overrideable by environment flags or request data.
  if (!isolation.available) throw Error(isolation.reason);
  inspectOpenCode();
  const spec = prepareOpenCode(input, syntheticKey, fixturePort);
  const child = spawn(
    "/usr/bin/sandbox-exec",
    ["-f", spec.sandboxPath, spec.executable, ...spec.argv],
    { cwd: spec.cwd, env: spec.env, shell: false, stdio: ["pipe", "pipe", "pipe"] },
  );
  const handle = supervise(
    child,
    spec.stdin,
    Math.max(1, spec.completionDeadline - Date.now()),
    spec.bindingDigest,
    spec.cleanup,
  );
  const abort = () => {
    void handle.stop();
  };
  input.signal.addEventListener("abort", abort, { once: true });
  void handle.completion
    .finally(() => input.signal.removeEventListener("abort", abort))
    .catch(() => {});
  if (input.signal.aborted) abort();
  return handle;
}
/** Shared process lifecycle, exercised only by the fixed inert fixture below. No arbitrary caller argv/path/env. */
function supervise(
  child: ChildProcessWithoutNullStreams,
  stdin: string,
  deadlineMs: number,
  bindingDigest: string,
  cleanup: () => void,
) {
  const decoder = new StringDecoder("utf8");
  let text = "",
    bytes = 0,
    closed = false,
    failed = false;
  let acknowledge!: (v: boolean) => void;
  const stopped = new Promise<boolean>((r) => (acknowledge = r));
  const timer = setTimeout(() => {
    failed = true;
    child.kill("SIGKILL");
  }, deadlineMs);
  const completion = new Promise<OpenCodeOutcome>((resolve, reject) => {
    child.on("error", () => {
      failed = true;
    });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > OPEN_CODE.maxOutputBytes) {
        failed = true;
        child.kill("SIGKILL");
      } else text += decoder.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > OPEN_CODE.maxOutputBytes) {
        failed = true;
        child.kill("SIGKILL");
      }
    });
    child.on("close", (code) => {
      closed = true;
      clearTimeout(timer);
      acknowledge(true);
      try {
        cleanup();
        if (failed || code !== 0) throw Error("process_failed");
        resolve({
          ...parseOpenCodeEvents(text + decoder.end(), bindingDigest),
          immediateChildClosed: true,
          accounting: {
            mode: "cli-job-unmetered-provider",
            cliJobs: 1,
            coordinatorRetries: 0,
            providerRequests: null,
            immediateChildClosed: true,
          },
        });
      } catch {
        reject(Error("process_unconfirmed"));
      }
    });
  });
  completion.catch(() => {});
  child.stdin.on("error", () => {
    failed = true;
  });
  child.stdin.end(stdin);
  return {
    completion,
    async stop() {
      if (closed) return true;
      failed = true;
      child.kill("SIGKILL");
      let t: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          stopped,
          new Promise<boolean>((r) => {
            t = setTimeout(() => r(false), 1000);
          }),
        ]);
      } finally {
        clearTimeout(t);
      }
    },
  };
}
/** Explicit fixed inert process test. It cannot execute OpenCode or a supplied command. */
export function startInertOpenCodeFixture(
  mode: "success" | "hang" | "oversize" | "cleanup-error",
  deadlineMs = 1000,
) {
  if (
    !["success", "hang", "oversize", "cleanup-error"].includes(mode) ||
    deadlineMs < 10 ||
    deadlineMs > 5000 ||
    Number(process.versions.node.split(".")[0]) < 26
  )
    throw Error("fixture_invalid");
  const source = `const mode=${JSON.stringify(mode)};process.stdin.resume();process.stdin.on('end',()=>{if(mode==='hang'){setInterval(()=>{},1000);return;}if(mode==='oversize'){process.stdout.write('x'.repeat(160000));return;}for(const e of [{type:'step_start',sessionID:'fixture-session',part:{}},{type:'text',sessionID:'fixture-session',part:{text:'synthetic'}},{type:'step_finish',sessionID:'fixture-session',part:{reason:'stop'}}])process.stdout.write(JSON.stringify(e)+'\\n');});`;
  const cwd = mkdtempSync(join(tmpdir(), "studio-opencode-fixture-"));
  const child = spawn(
    process.execPath,
    ["--permission", "--no-addons", "--disable-proto=throw", "--input-type=module", "-e", source],
    { cwd, env: {}, shell: false, stdio: ["pipe", "pipe", "pipe"] },
  );
  return supervise(child, "synthetic", deadlineMs, digest({ mode }), () => {
    rmSync(cwd, { recursive: true, force: true });
    if (mode === "cleanup-error") throw Error("synthetic_cleanup_failure");
  });
}
