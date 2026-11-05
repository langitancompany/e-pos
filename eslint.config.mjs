import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Cegah console.log debug tertinggal di kode produksi.
    // console.warn / console.error tetap boleh untuk pelaporan masalah.
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      // Aturan baru dari React Compiler lint. Pola yang ditandai (fetch saat
      // mount, baca localStorage, jam setInterval) sudah dipakai luas di app ini,
      // jadi sementara jadi warning supaya CI tidak gagal. Rapikan bertahap;
      // jangan sampai jumlah warning-nya bertambah.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
