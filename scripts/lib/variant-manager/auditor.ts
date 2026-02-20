/**
 * Auditor — Phase 2: Audit parent products and detect issues.
 *
 * Checks each variable parent for problems in priority order:
 * 1. all-discontinued — all variations' SKUs are discontinued
 * 2. has-discontinued — some variations are discontinued
 * 3. needs-split — multiple SKU prefix groups found
 * 4. multi-attribute — >1 distinct attribute_pa_* key
 * 5. wrong-attribute — attribute doesn't match category rules
 * 6. duplicate-attrs — variations share identical attribute values
 * 7. ok — no issues
 */

import type { Connection } from 'mysql2/promise';
import type {
  AuditResult, AuditIssue, FeedIndex, ParentProduct,
  VariationRecord, VariantManagerOptions,
} from './types';
import { isDiscontinued } from './feed-index';
import { groupBySkuPrefix, adaptiveSkuSubSplit } from './sku-patterns';
import { isLubricantCategory } from './category-rules';
import { getAllowedAttributes, taxonomyToAttrType } from './category-rules';
import {
  loadVariableParents, loadAllVariableParents, loadVariationsWithMeta,
  loadParentAttributes, loadProductCategories,
} from './db-queries';

/**
 * Run a full audit across all (or filtered) variable parents.
 */
export async function auditAll(
  db: Connection,
  feedIndex: FeedIndex,
  opts: VariantManagerOptions
): Promise<AuditResult[]> {
  console.log('\n--- Phase 2: Auditing variable parents ---');

  // Load parents
  const parents = await loadAllVariableParents(db, {
    parentId: opts.parentId,
    limit: opts.limit,
  });
  console.log(`  Loaded ${parents.length} variable parents`);

  if (parents.length === 0) return [];

  const parentIds = parents.map(p => p.id);

  // Batch-load all related data
  const [variationsMap, attrsMap, categoriesMap] = await Promise.all([
    loadVariationsWithMeta(db, parentIds, feedIndex),
    loadParentAttributes(db, parentIds),
    loadProductCategories(db, parentIds),
  ]);

  console.log(`  Loaded variations for ${variationsMap.size} parents`);

  // Audit each parent
  const results: AuditResult[] = [];
  let issueCount = 0;

  for (const parent of parents) {
    const variations = variationsMap.get(parent.id) || [];
    if (variations.length === 0) continue;

    const categorySlugs = categoriesMap.get(parent.id) || [];
    const productAttributes = attrsMap.get(parent.id) || {};

    const result = auditParent(parent, variations, categorySlugs, productAttributes, feedIndex, opts);
    results.push(result);

    if (!result.issues.includes('ok')) {
      issueCount++;
      if (opts.verbose) {
        console.log(`  [${parent.id}] ${parent.title}: ${result.issues.join(', ')}`);
      }
    }
  }

  console.log(`  Audit complete: ${issueCount} parents with issues, ${results.length - issueCount} OK`);
  return results;
}

/**
 * Audit a single parent product and return all detected issues.
 */
function auditParent(
  parent: ParentProduct,
  variations: VariationRecord[],
  categorySlugs: string[],
  productAttributes: Record<string, any>,
  feedIndex: FeedIndex,
  opts: VariantManagerOptions
): AuditResult {
  const issues: AuditIssue[] = [];
  const isLubricant = isLubricantCategory(categorySlugs);
  const discontinuedVarIds: number[] = [];

  // 1. Check discontinued status
  for (const v of variations) {
    if (v.warehouseSku || v.sku) {
      if (isDiscontinued(feedIndex, v.warehouseSku, v.sku)) {
        discontinuedVarIds.push(v.id);
      }
    }
  }

  if (discontinuedVarIds.length === variations.length && discontinuedVarIds.length > 0) {
    issues.push('all-discontinued');
  } else if (discontinuedVarIds.length > 0) {
    issues.push('has-discontinued');
  }

  // 2. Check if needs splitting (multiple SKU prefix groups)
  const skuGroups = groupBySkuPrefix(variations);
  if (skuGroups && skuGroups.size > 1) {
    // Same-price anti-split: if ALL variations have the same price,
    // they're variants (color/style/flavor) of one product, not different lines.
    const allPrices = new Set(
      variations.filter(v => v.regularPrice > 0).map(v => v.regularPrice)
    );
    const isUniformPrice = allPrices.size <= 1;

    if (!isUniformPrice) {
      // Only split when prices differ — that's the signal for different product lines
      adaptiveSkuSubSplit(skuGroups);
      if (skuGroups.size > 1) {
        issues.push('needs-split');
      }
    }
    // If uniform price, skip the split — they belong together
  }

  // 3. Check attribute issues
  const attrKeys = getDistinctAttrKeys(variations);

  if (attrKeys.length > 1) {
    issues.push('multi-attribute');
  }

  if (attrKeys.length === 1) {
    const taxonomy = attrKeys[0].replace('attribute_', '');
    const currentType = taxonomyToAttrType(taxonomy);
    const allowed = getAllowedAttributes(isLubricant);
    if (!allowed.includes(currentType) && currentType !== 'variant') {
      issues.push('wrong-attribute');
    }
  }

  // 4. Check for duplicate attribute values
  if (hasDuplicateAttrValues(variations)) {
    issues.push('duplicate-attrs');
  }

  // 5. Check if parent name appears in attribute values
  if (hasParentNameInAttrs(variations, parent.title)) {
    issues.push('parent-name-in-attrs');
  }

  if (issues.length === 0) {
    issues.push('ok');
  }

  return {
    parentId: parent.id,
    parentTitle: parent.title,
    parentSlug: parent.slug,
    issues,
    variations,
    categorySlugs,
    isLubricant,
    discontinuedVarIds,
    skuGroups: skuGroups || undefined,
    attrKeys,
    productAttributes,
  };
}

/**
 * Get distinct attribute_pa_* keys used across variations.
 */
function getDistinctAttrKeys(variations: VariationRecord[]): string[] {
  const keys = new Set<string>();
  for (const v of variations) {
    for (const key of v.attrs.keys()) {
      if (key.startsWith('attribute_pa_')) {
        keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

/**
 * Check if any variations share identical attribute values for the same key.
 */
function hasDuplicateAttrValues(variations: VariationRecord[]): boolean {
  // Build a fingerprint per variation from all attribute values
  const fingerprints = new Set<string>();
  for (const v of variations) {
    const parts: string[] = [];
    for (const [key, value] of [...v.attrs.entries()].sort()) {
      if (key.startsWith('attribute_pa_')) {
        parts.push(`${key}=${value}`);
      }
    }
    const fp = parts.join('|');
    if (fp && fingerprints.has(fp)) return true;
    if (fp) fingerprints.add(fp);
  }
  return false;
}

/**
 * Check if any variation attribute values contain the parent product name.
 */
function hasParentNameInAttrs(variations: VariationRecord[], parentTitle: string): boolean {
  if (!parentTitle || parentTitle.length < 4) return false;
  const parentSlug = parentTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // Only check if parent slug is long enough to be meaningful
  if (parentSlug.length < 6) return false;

  for (const v of variations) {
    for (const [key, value] of v.attrs.entries()) {
      if (key.startsWith('attribute_pa_') && value) {
        const valLower = value.toLowerCase();
        if (valLower.startsWith(parentSlug + '-') || valLower.startsWith(parentSlug)) {
          return true;
        }
      }
    }
  }
  return false;
}
