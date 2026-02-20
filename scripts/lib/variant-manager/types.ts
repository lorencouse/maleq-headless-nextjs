/**
 * Shared types for the Unified Variant Manager pipeline.
 *
 * All modules import from here to avoid circular dependencies.
 */

import type { Connection } from 'mysql2/promise';

// ==================== Feed Types ====================

export type FeedSource = 'williams-active' | 'williams-inactive' | 'stc';

export interface FeedProduct {
  sku: string;
  barcode: string;
  name: string;
  color: string;
  material: string;
  size: string;
  height: string;
  length: string;
  diameter: string;
  weight: string;
  description: string;
  source: FeedSource;
}

export interface FeedIndex {
  /** Warehouse SKU or barcode → feed product */
  skuLookup: Map<string, FeedProduct>;
  /** Barcode (UPC) → warehouse SKU */
  barcodeToWtSku: Map<string, string>;
  /** SKUs present in products-filtered.xml */
  williamsActiveSkus: Set<string>;
  /** Barcodes/handles present in stc-product-feed.csv */
  stcIdentifiers: Set<string>;
  /** SKUs in inactive XML AND NOT in active/STC — truly discontinued */
  discontinuedSkus: Set<string>;
}

// ==================== SKU Pattern Types ====================

export type SkuPattern = 'A' | 'B' | 'none';

export interface ParsedSku {
  parentSku: string;
  variantId: string;
  siblingGroup?: string;
  family?: string;
  pattern: SkuPattern;
}

// ==================== DB Product Types ====================

export interface ParentProduct {
  id: number;
  title: string;
  slug: string;
  status: string;
  varCount: number;
}

export interface VariationRecord {
  id: number;
  parentId: number;
  title: string;
  slug: string;
  excerpt: string;
  status: string;
  sku: string;
  warehouseSku: string;
  regularPrice: number;
  /** attribute_pa_* meta keys → values */
  attrs: Map<string, string>;
  /** Resolved feed product (if found) */
  feedProduct?: FeedProduct;
}

export interface SimpleProduct {
  id: number;
  title: string;
  slug: string;
  status: string;
  sku: string;
  warehouseSku: string;
  regularPrice: number;
  brand?: string;
  categorySlugs: string[];
}

// ==================== Classification Types ====================

export type AttributeType = 'size' | 'color' | 'type' | 'variant' | 'unknown';

export interface ClassifiedValue {
  type: AttributeType;
  value: string;
  normalized: string;
}

// ==================== Audit Types ====================

export type AuditIssue =
  | 'all-discontinued'
  | 'has-discontinued'
  | 'needs-split'
  | 'multi-attribute'
  | 'wrong-attribute'
  | 'duplicate-attrs'
  | 'parent-name-in-attrs'
  | 'ok';

export interface AuditResult {
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  issues: AuditIssue[];
  variations: VariationRecord[];
  categorySlugs: string[];
  isLubricant: boolean;
  /** Variation IDs that are discontinued */
  discontinuedVarIds: number[];
  /** SKU prefix groups (if needs-split) */
  skuGroups?: Map<string, VariationRecord[]>;
  /** Distinct attribute keys across variations */
  attrKeys: string[];
  /** Deserialized _product_attributes from parent */
  productAttributes: Record<string, any>;
}

// ==================== Plan Types ====================

export type ActionType =
  | 'convert-to-draft'
  | 'delete-discontinued'
  | 'split-product-lines'
  | 'fix-duplicate-attrs'
  | 'reduce-to-single-attr'
  | 'reclassify-attribute'
  | 'convert-simple-to-variable';

export interface SplitGroupPlan {
  label: string;
  variationIds: number[];
  skuPrefix?: string;
  newParentTitle: string;
  newParentSlug: string;
  isKeepGroup: boolean;
}

export interface PlannedAction {
  type: ActionType;
  priority: number;
  parentId: number;
  parentTitle: string;
  parentSlug: string;
  confidence: number;
  confidenceFlags: string[];
  /** For delete-discontinued */
  deleteVarIds?: number[];
  /** For split-product-lines */
  splitGroups?: SplitGroupPlan[];
  /** For fix-duplicate-attrs / reduce-to-single-attr / reclassify-attribute */
  attrChanges?: AttrChange[];
  /** For reclassify */
  reclassifyFrom?: string;
  reclassifyTo?: string;
  /** For reduce-to-single-attr */
  keepDimension?: string;
  removeDimension?: string;
  /** New terms that need to be created in wp_terms */
  newTermsNeeded?: string[];
}

export interface AttrChange {
  variationId: number;
  oldKey: string;
  oldValue: string;
  newKey: string;
  newValue: string;
  newSlug: string;
}

export interface PipelinePlan {
  timestamp: string;
  summary: {
    totalParentsScanned: number;
    totalActionsPlanned: number;
    actionsByType: Record<string, number>;
    totalVariationsAffected: number;
    totalNewParentsToCreate: number;
  };
  actions: PlannedAction[];
  skipped: Array<{ parentId: number; parentTitle: string; reason: string }>;
}

// ==================== Execution Types ====================

export interface SnapshotVariation {
  id: number;
  sku: string;
  warehouseSku: string;
  price: string;
  attrKey: string;
  attrValue: string;
  feedName: string;
  status: string;
}

export interface NewParentInfo {
  id: number;
  title: string;
  slug: string;
  variationCount: number;
}

export interface ExecutionResult {
  actionIndex: number;
  action: PlannedAction;
  success: boolean;
  error?: string;
  before?: SnapshotVariation[];
  after?: SnapshotVariation[];
  newParentIds?: number[];
  /** Actual new parent products created (with real DB slugs) */
  newParents?: NewParentInfo[];
}

export interface ExecutionLog {
  timestamp: string;
  mode: string;
  results: ExecutionResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
}

// ==================== Checkpoint Types ====================

export interface VariantCheckpoint {
  completedParentIds: number[];
  completedActionIndices: number[];
  successCount: number;
  errorCount: number;
  errors: Array<{ parentId: number; error: string }>;
  lastBatchAt: string;
  planFile: string;
}

// ==================== CLI Options ====================

export interface VariantManagerOptions {
  mode: 'analyze' | 'dry-run' | 'apply';
  output: string;
  planFile?: string;
  parentId?: number;
  limit?: number;
  minConfidence: number;
  actionTypes?: ActionType[];
  resume: boolean;
  verbose: boolean;
}
