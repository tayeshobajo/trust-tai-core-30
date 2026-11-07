import { lstatSync, openSync, closeSync, fstatSync, readFileSync, constants } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
export const LINUX_RUNTIME = {
  observedPath: "/home/paperclip/.npm-global/lib/node_modules/opencode-ai/bin/opencode.exe",
  protectedPath: "/opt/trusttai/studio-runtime/opencode-1.18.18",
  packageVersion: "1.18.18",
  versionEvidence: "package-metadata-not-runtime-attestation",
  sha256: "bb71f45b564f9234a97f54d6252a4a41d2f4388ae4b078918f691824cc3b3e54",
  paperclipVersion: "2026.1012.0",
  maxInputBytes: 25000,
  maxOutputBytes: 150000,
  timeoutMs: 60000,
  killGraceMs: 5000,
} as const;
/** Read-only preflight for the PROPOSED root-owned copy, never accepts a caller path. Does not launch. */
export function inspectProtectedLinuxExecutable() {
  if (process.platform !== "linux") throw Error("linux_required");
  // 1.18.18 merges managed config after private config. Do not override operator policy.
  try {
    lstatSync("/etc/opencode");
    throw Error("managed_opencode_config_requires_review");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let p: string = LINUX_RUNTIME.protectedPath;
  for (;;) {
    const s = lstatSync(p);
    if (s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o022) !== 0)
      throw Error("executable_ownership_unverified");
    if (p === "/") break;
    p = dirname(p);
  }
  const fd = openSync(LINUX_RUNTIME.protectedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.uid !== 0 || (before.mode & 0o022) !== 0)
      throw Error("executable_unverified");
    const sha = createHash("sha256").update(readFileSync(fd)).digest("hex"),
      after = fstatSync(fd);
    if (
      sha !== LINUX_RUNTIME.sha256 ||
      before.ino !== after.ino ||
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size
    )
      throw Error("executable_changed");
    return {
      sha256: sha,
      packageVersion: LINUX_RUNTIME.packageVersion,
      versionEvidence: LINUX_RUNTIME.versionEvidence,
    };
  } finally {
    closeSync(fd);
  }
}
