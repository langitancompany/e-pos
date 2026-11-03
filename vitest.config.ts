import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Test hanya untuk logika murni (lib/**). Tidak butuh DOM, jadi environment "node".
// Alias "@" harus sama dengan `paths` di tsconfig.json.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
