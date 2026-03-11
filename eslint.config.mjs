import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated and local-only artifacts:
    ".cache/**",
    "audit-inputs/**",
    "backups/**",
    "data/**",
    "app/api/dev/**",
    "jest.config.js",
    "lib/import/**",
    "lib/williams-trading/**",
    "playwright-report/**",
    "scripts/**",
    "test-results/**",
    "lib/redirects/product-redirects.ts",
  ]),
]);

export default eslintConfig;
