/** Linux candidate based on 2026-11-07 read-only host evidence. No installed SDK credential inheritance. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import { COORDINATOR, digest, profileSchema } from "./studio-research-coordinator-contracts";
import { parseOpenCodeEvents } from "./studio-research-opencode-executor.server";
import type { Capture, ExecutionInput } from "./studio-research-coordinator.server";
import {
  LINUX_RUNTIME,
  inspectProtectedLinuxExecutable,
} from "./studio-research-linux-runtime-preflight.server";
export { LINUX_RUNTIME, inspectProtectedLinuxExecutable };
export function linuxRuntimeReadiness() {
  return {
    available: false as const,
    reasons: [
      "protected_executable_not_installed",
      "preview_runtime_not_configured",
      "linux_cli_profile_unverified",
      "scoped_host_admission_not_installed",
      "linux_profile_host_smoke_test_pending",
    ] as const,
    optionalHardening: ["per_job_os_containment", "cpu_memory_limits", "egress_firewall"] as const,
  };
}
/** Synthetic credential only. Fixed loopback fixture is never started/contacted here. */
export function prepareLinuxRun(input: ExecutionInput, syntheticKey: string, now: number) {
  if (!/^synthetic-[A-Za-z0-9-]{1,80}$/.test(syntheticKey))
    throw Error("synthetic_credential_required");
  return preparePrivateRun(input, syntheticKey, "http://127.0.0.1:43119/v1", now);
}
function preparePrivateRun(
  input: ExecutionInput,
  providerKey: string,
  endpoint: string,
  now: number,
) {
  profileSchema.parse(input.profile);
  for (const time of [now, input.launchDeadline, input.completionDeadline])
    z.number().finite().int().nonnegative().parse(time);
  for (const id of [input.requestId, input.issueId, input.runId, input.nonce])
    z.string().uuid().parse(id);
  z.string()
    .regex(/^ses_[0-9a-f-]{36}$/)
    .parse(input.sessionId);
  if (
    !/^[A-Za-z0-9._-]{1,512}$/.test(providerKey) ||
    input.signal.aborted ||
    now >= input.launchDeadline ||
    input.launchDeadline - now > 5000 ||
    input.launchDeadline > input.completionDeadline ||
    input.completionDeadline <= now ||
    input.completionDeadline - now > 60000 ||
    Buffer.byteLength(input.prompt) > 25000
  )
    throw Error("linux_input_invalid");
  const cwd = mkdtempSync(join(tmpdir(), "studio-linux-"));
  try {
    for (const d of ["home", "config", "data", "cache", "state", "tmp"])
      mkdirSync(join(cwd, d), { mode: 0o700 });
    for (const file of ["npm-user.conf", "npm-global.conf"])
      writeFileSync(
        join(cwd, file),
        "offline=true\nignore-scripts=true\naudit=false\nfund=false\n",
        { mode: 0o600, flag: "wx" },
      );
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
          options: { apiKey: providerKey, baseURL: endpoint },
          models: { "glm-5.3": { name: "GLM 5.3", limit: { context: 32000, output: 2048 } } },
        },
      },
    };
    const configPath = join(cwd, "config", "opencode.json");
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600, flag: "wx" });
    const binding = {
      requestId: input.requestId,
      issueId: input.issueId,
      runId: input.runId,
      coordinatorSessionId: input.sessionId,
      nonce: input.nonce,
      promptDigest: digest(input.prompt),
      profileDigest: digest(input.profile),
      executableSha256: LINUX_RUNTIME.sha256,
      packageVersion: LINUX_RUNTIME.packageVersion,
    };
    writeFileSync(join(cwd, "binding.json"), JSON.stringify(binding), { mode: 0o600, flag: "wx" });
    const env = {
      HOME: join(cwd, "home"),
      XDG_CONFIG_HOME: join(cwd, "config"),
      XDG_DATA_HOME: join(cwd, "data"),
      XDG_CACHE_HOME: join(cwd, "cache"),
      XDG_STATE_HOME: join(cwd, "state"),
      TMPDIR: join(cwd, "tmp"),
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      npm_config_offline: "true",
      npm_config_ignore_scripts: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_cache: join(cwd, "cache", "npm"),
      npm_config_userconfig: join(cwd, "npm-user.conf"),
      npm_config_globalconfig: join(cwd, "npm-global.conf"),
      OPENCODE_CONFIG: configPath,
      OPENCODE_CONFIG_DIR: join(cwd, "config"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "true",
      OPENCODE_DISABLE_MODELS_FETCH: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_PURE: "true",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
      OPENCODE_DISABLE_CLAUDE_CODE: "true",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
      OPENCODE_DISABLE_AUTOCOMPACT: "true",
      OPENCODE_DISABLE_PRUNE: "true",
      OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
      OPENCODE_PERMISSION: '{"*":"deny"}',
    };
    return {
      executable: LINUX_RUNTIME.protectedPath,
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
      options: {
        cwd,
        env,
        shell: false as const,
        detached: true as const,
        stdio: ["pipe", "pipe", "pipe"] as const,
      },
      stdin: input.prompt,
      bindingDigest: digest(binding),
      deadline: input.completionDeadline,
      // Revoke the on-disk provider secret even if child close is uncertain.
      removeCredential: () => {
        try {
          unlinkSync(configPath);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      },
      cleanup: () => rmSync(cwd, { recursive: true, force: true }),
    };
  } catch (e) {
    rmSync(cwd, { recursive: true, force: true });
    throw e;
  }
}
export type LinuxStopObservation = {
  scope: "process-group";
  termSent: boolean;
  killSent: boolean;
  immediateChildClosed: boolean;
  groupAbsentObserved: boolean;
  escapedDescendants: "unverified";
  providerCancellation: "unverified";
};
/** Standard Node Linux process-group signalling, never fallback to a different PID on group failure. */
export function observeLinuxProcess(
  child: ChildProcessWithoutNullStreams,
  deadlineMs: number,
  bindingDigest: string,
  signalGroup: (pgid: number, signal: NodeJS.Signals | 0) => void = process.kill,
) {
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(bindingDigest);
  z.number().finite().int().min(1).max(60000).parse(deadlineMs);
  const pgid = child.pid;
  if (!pgid || !Number.isSafeInteger(pgid) || pgid <= 1) throw Error("process_group_unverified");
  let closed = false,
    failed = false,
    termSent = false,
    termAttempted = false,
    killSent = false,
    bytes = 0,
    text = "",
    killTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectCompletion!: (error: Error) => void;
  let uncertainTimer: ReturnType<typeof setTimeout> | undefined;
  const decoder = new StringDecoder("utf8");
  const send = (signal: NodeJS.Signals) => {
    try {
      signalGroup(-pgid, signal);
      return true;
    } catch {
      return false;
    }
  };
  const terminate = () => {
    if (closed) return;
    failed = true;
    if (!uncertainTimer)
      uncertainTimer = setTimeout(
        () => rejectCompletion(Error("linux_termination_unconfirmed")),
        6000,
      );
    if (!termAttempted) {
      termAttempted = true;
      termSent = send("SIGTERM");
    }
    if (!killTimer)
      killTimer = setTimeout(() => {
        if (!closed) killSent = send("SIGKILL");
      }, 5000);
  };
  const timer = setTimeout(terminate, Math.min(60000, Math.max(1, deadlineMs)));
  let resolveCompletion!: (value: ReturnType<typeof parseOpenCodeEvents>) => void;
  const completion = new Promise<ReturnType<typeof parseOpenCodeEvents>>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  completion.catch(() => {});
  try {
    child.on("error", () => {
      failed = true;
      terminate();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 150000) terminate();
      else text += decoder.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 150000) terminate();
    });
    child.on("close", (code) => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(uncertainTimer);
      try {
        if (failed || code !== 0) throw Error();
        resolveCompletion(parseOpenCodeEvents(text + decoder.end(), bindingDigest));
      } catch {
        rejectCompletion(Error("linux_completion_unconfirmed"));
      }
    });
  } catch (error) {
    clearTimeout(timer);
    clearTimeout(killTimer);
    clearTimeout(uncertainTimer);
    rejectCompletion(Error("linux_observer_initialization_failed"));
    throw error;
  }
  return {
    completion,
    capturedStdout: () => {
      if (!closed || failed) throw Error("linux_capture_unavailable");
      return text;
    },
    stop: () => {
      terminate();
    },
    observation: (): LinuxStopObservation => {
      let absent = false;
      try {
        signalGroup(-pgid, 0);
      } catch (e) {
        absent = (e as NodeJS.ErrnoException).code === "ESRCH";
      }
      return {
        scope: "process-group",
        termSent,
        killSent,
        immediateChildClosed: closed,
        groupAbsentObserved: absent,
        escapedDescendants: "unverified",
        providerCancellation: "unverified",
      };
    },
    dispose: () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(uncertainTimer);
      rejectCompletion(Error("linux_observer_disposed"));
    },
  };
}
/** Trusted server dependencies only; never populated from request JSON or environment toggles.
 * The installed composition must bind authorizeCurrent to current signed Studio + host admission.
 * Each factory permits one CLI job, even after ambiguous failure. No retry or second start.
 */
export type LinuxPreviewSetup = {
  authorizeCurrent(input: Readonly<ExecutionInput>): Promise<void>;
  providerKey(): Promise<string>;
  shutdownSignal?: AbortSignal;
};
export function createLinuxPreviewExecutor(setup: LinuxPreviewSetup) {
  let consumed = false;
  return {
    async start(input: ExecutionInput) {
      return startLinuxRun(input);
    },
  };
  async function startLinuxRun(original: ExecutionInput) {
    if (consumed) throw Error("preview_launch_consumed");
    const input = Object.freeze({
      ...original,
      signal: setup.shutdownSignal
        ? AbortSignal.any([original.signal, setup.shutdownSignal])
        : original.signal,
      profile: Object.freeze(profileSchema.parse(original.profile)),
    });
    consumed = true;
    const assertLaunch = () => {
      for (const n of [input.launchDeadline, input.completionDeadline])
        z.number().finite().int().nonnegative().parse(n);
      if (
        input.signal.aborted ||
        Date.now() >= input.launchDeadline ||
        input.launchDeadline - Date.now() > 5000 ||
        input.completionDeadline - Date.now() > 60000
      )
        throw Error("launch_expired");
    };
    assertLaunch();
    inspectProtectedLinuxExecutable();
    await setup.authorizeCurrent(input);
    assertLaunch();
    let key = await setup.providerKey();
    assertLaunch();
    if (!/^[A-Za-z0-9._-]{16,512}$/.test(key)) throw Error("provider_key_invalid");
    const spec = preparePrivateRun(input, key, COORDINATOR.endpoint, Date.now());
    key = "";
    let child: ChildProcessWithoutNullStreams | undefined;
    let observer: ReturnType<typeof observeLinuxProcess> | undefined;
    let abort: (() => void) | undefined;
    let childClosed = false;
    try {
      await setup.authorizeCurrent(input);
      assertLaunch();
      // Reinspect immediately before exec after asynchronous authority/credential work.
      inspectProtectedLinuxExecutable();
      assertLaunch();
      const remaining = Math.max(1, Math.min(60000, input.completionDeadline - Date.now()));
      z.number().finite().int().min(1).max(60000).parse(remaining);
      child = spawn(spec.executable, spec.argv, {
        ...spec.options,
        stdio: ["pipe", "pipe", "pipe"],
      });
      // spawn failure emits error asynchronously, even when pid is missing.
      child.on("error", () => {});
      child.once("close", () => {
        childClosed = true;
      });
      child.stdin.on("error", () => {
        observer?.stop();
      });
      observer = observeLinuxProcess(child, remaining, spec.bindingDigest);
      const h = observer;
      abort = () => h.stop();
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) h.stop();
      else child.stdin.end(spec.stdin);
      const completion: Promise<Capture> = h.completion
        .then((result): Capture => {
          if (input.signal.aborted || Date.now() >= input.completionDeadline)
            throw Error("completion_expired");
          return {
            stdout: h.capturedStdout(),
            receipt: {
              requestId: input.requestId,
              issueId: input.issueId,
              runId: input.runId,
              agentId: COORDINATOR.agentId,
              projectId: COORDINATOR.projectId,
              sessionId: input.sessionId,
              exitCode: 0,
              timedOut: false,
              attempts: 1,
              nativeSession: {
                version: 1,
                id: result.nativeSessionId,
                bindingDigest: spec.bindingDigest,
              },
            },
            nonce: input.nonce,
            providerRequests: null,
            accounting: {
              mode: "cli-job-unmetered-provider",
              cliJobs: 1,
              coordinatorRetries: 0,
              providerRequests: null,
              immediateChildClosed: true,
            },
          };
        })
        .finally(() => {
          input.signal.removeEventListener("abort", abort!);
          spec.removeCredential();
          // Retained CLI state may contain sensitive copies; operator cleanup is required on uncertain close.
          if (h.observation().immediateChildClosed) spec.cleanup();
        });
      completion.catch(() => {});
      return {
        completion,
        stop: async () => {
          h.stop();
          await completion.catch(() => {});
          return false;
        },
        // false means the legacy all-stopped acknowledgement is NOT established.
        observation: h.observation,
      };
    } catch (error) {
      observer?.stop();
      if (
        !observer &&
        child?.pid &&
        Number.isSafeInteger(child.pid) &&
        child.pid > 1 &&
        !childClosed
      ) {
        const pgid = child.pid;
        try {
          process.kill(-pgid, "SIGTERM");
        } catch {
          /* group-only, no PID fallback */
        }
        const timer = setTimeout(() => {
          if (!childClosed) {
            try {
              process.kill(-pgid, "SIGKILL");
            } catch {
              /* unconfirmed */
            }
          }
        }, 5000);
        child.once("close", () => {
          clearTimeout(timer);
          try {
            spec.cleanup();
          } catch {
            /* retained state needs operator cleanup; never throw from close callback */
          }
        });
      }
      if (abort) input.signal.removeEventListener("abort", abort);
      spec.removeCredential();
      if (!child?.pid) spec.cleanup();
      throw error;
    }
  }
}
