import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  plugins: [tailwindcss(), react(), viteSingleFile()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist-mcp-app",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { input: "mcp-app.html" },
  },
});
