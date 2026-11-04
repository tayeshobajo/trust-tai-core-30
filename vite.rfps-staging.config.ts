import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { stagingConfig, stagingCsp } from "./qa/rfps-staging/guard";
const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig(({ mode }) => {
  const config = stagingConfig({ ...loadEnv(mode, root, "VITE_RFP_STAGING_"), ...process.env });
  return {
    root: root + "qa/rfps-staging",
    envDir: root,
    plugins: [
      react(),
      tailwind(),
      {
        name: "rfp-staging-csp",
        transformIndexHtml(html) {
          return html.replace("__RFP_CSP__", stagingCsp(config));
        },
      },
    ],
    resolve: {
      alias: [
        {
          find: "@/integrations/trust-tai/supabase",
          replacement: root + "qa/rfps-staging/client.ts",
        },
        { find: "@", replacement: root + "src" },
      ],
    },
    build: { outDir: root + "qa/rfps-staging/dist", emptyOutDir: true },
    server: { host: "127.0.0.1", port: 4351, strictPort: true, hmr: false, fs: { allow: [root] } },
    preview: { host: "127.0.0.1", port: 4351, strictPort: true },
  };
});
