import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const previewRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: previewRoot,
  resolve: { alias: { "@": repositoryRoot } },
  server: { host: "127.0.0.1", port: 5176 },
  build: { outDir: "dist", emptyOutDir: true },
});
