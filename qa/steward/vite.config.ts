import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@/hooks/use-presence": fileURLToPath(new URL("./presence.ts", import.meta.url)),
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  server: { host: "127.0.0.1", port: 4176, strictPort: true },
});
