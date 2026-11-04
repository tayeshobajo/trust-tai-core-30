import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
export default defineConfig({
  root: path.resolve(".comms-preview"),
  publicDir: path.resolve("public"),
  cacheDir: path.resolve(".comms-preview/cache"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve("src") } },
  server: {
    headers: { "Content-Security-Policy": "connect-src 'self' ws://127.0.0.1:4345" },
    host: "127.0.0.1",
    port: 4345,
    strictPort: true,
    fs: {
      allow: [path.resolve("."), "/Users/tayeshobajo/Developer/trust-tai-core-30/node_modules"],
    },
  },
});
