import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Test untuk logika murni (lib/**, helper di app/components/**, dan fungsi murni di
// hooks/**). Tidak butuh DOM, jadi environment "node".
// Alias "@" harus sama dengan `paths` di tsconfig.json.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "app/**/*.test.ts",
      "hooks/**/*.test.ts",
    ],
  },
});
