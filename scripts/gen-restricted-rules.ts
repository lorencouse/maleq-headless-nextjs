/**
 * Export the restricted-product rules to JSON for the WordPress-side guard.
 *
 *   bun scripts/gen-restricted-rules.ts          # (re)write wordpress/mu-plugins/maleq-restricted-rules.json
 *   bun scripts/gen-restricted-rules.ts --check  # exit 1 if the file on disk is stale (CI)
 *
 * Source of truth is lib/import/restricted-products.ts (+ data/restricted-allowlist.json).
 * `maleq-restricted-products-guard.php` reads the JSON on every product save, so run
 * this after editing a rule, the brand blocklist or the allowlist, and deploy the JSON
 * together with the mu-plugins (docs/DEPLOYMENT_GUIDE.md).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import {
  buildSerializedRestrictedRules,
  SERIALIZED_RULES_PATH,
} from '../lib/import/restricted-products';

const check = process.argv.includes('--check');
const next = JSON.stringify(buildSerializedRestrictedRules(), null, 2) + '\n';
const current = existsSync(SERIALIZED_RULES_PATH) ? readFileSync(SERIALIZED_RULES_PATH, 'utf-8') : '';

if (current === next) {
  console.log(`✓ ${SERIALIZED_RULES_PATH} is up to date`);
  process.exit(0);
}

if (check) {
  console.error(`✗ ${SERIALIZED_RULES_PATH} is stale — run: bun scripts/gen-restricted-rules.ts`);
  process.exit(1);
}

writeFileSync(SERIALIZED_RULES_PATH, next);
console.log(`✓ wrote ${SERIALIZED_RULES_PATH}`);
