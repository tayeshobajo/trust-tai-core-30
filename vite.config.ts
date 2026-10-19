// @lovable.dev/vite-tanstack-config already includes the following, do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: {... }, etc... }) if needed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    plugins: [
      {
        name: "steward-build-revision",
        apply: "build",
        generateBundle() {
          let revision: string | null = null;
          let dirty: boolean | null = null;
          try {
            revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
            dirty =
              execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
                encoding: "utf8",
              }).trim().length > 0;
          } catch {
            /* Unknown stays unknown on hosts without Git metadata. */
          }
          const sourceFiles: string[] = [];
          const collect = (directory: string) => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
              const path = join(directory, entry.name);
              if (entry.isDirectory()) collect(path);
              else if (entry.isFile()) sourceFiles.push(path);
            }
          };
          collect("src");
          for (const path of [
            "vite.config.ts",
            "package.json",
            "package-lock.json",
            "bun.lock",
            "bun.lockb",
            "tsconfig.json",
          ])
            if (existsSync(path)) sourceFiles.push(path);
          const hash = createHash("sha256");
          for (const path of sourceFiles.sort())
            hash.update(path).update("\0").update(readFileSync(path)).update("\0");
          this.emitFile({
            type: "asset",
            fileName: "steward-build.json",
            source: JSON.stringify({ revision, dirty, sourceFingerprint: hash.digest("hex") }),
          });
        },
      },
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Colocated route tests are not routes.
    router: { routeFileIgnorePattern: "\\.test\\." },
  },
});
