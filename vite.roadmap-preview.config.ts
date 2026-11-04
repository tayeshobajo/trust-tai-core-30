import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL("./qa/roadmaps-three-pane", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "@": repo + "src" } },
  server: {
    host: "127.0.0.1",
    port: 4339,
    strictPort: true,
    fs: {
      allow: [
        repo,
        fileURLToPath(new URL("../cmd-preview-integration/node_modules", import.meta.url)),
      ],
    },
  },
});
