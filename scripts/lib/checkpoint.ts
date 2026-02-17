/**
 * Checkpoint / Resume Logic
 *
 * Saves progress every batch so long-running enrichment can be resumed.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CHECKPOINT_PATH = join(process.cwd(), 'data', 'enrichment-checkpoint.json');

export interface CheckpointData {
  processedIds: number[];
  successCount: number;
  fallbackCount: number;
  errorCount: number;
  skippedCount: number;
  errors: Array<{ postId: number; error: string }>;
  lastBatchAt: string;
  csvPath: string;
}

export function loadCheckpoint(): CheckpointData | null {
  if (!existsSync(CHECKPOINT_PATH)) return null;
  try {
    const raw = readFileSync(CHECKPOINT_PATH, 'utf-8');
    return JSON.parse(raw) as CheckpointData;
  } catch {
    console.warn('⚠ Failed to read checkpoint, starting fresh');
    return null;
  }
}

export function saveCheckpoint(data: CheckpointData): void {
  data.lastBatchAt = new Date().toISOString();
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(data, null, 2));
}

export function createCheckpoint(csvPath: string): CheckpointData {
  return {
    processedIds: [],
    successCount: 0,
    fallbackCount: 0,
    errorCount: 0,
    skippedCount: 0,
    errors: [],
    lastBatchAt: new Date().toISOString(),
    csvPath,
  };
}

/**
 * Check error budget: pause if >20% error rate in a batch.
 * Returns true if we should stop.
 */
export function shouldPause(batchErrors: number, batchSize: number): boolean {
  if (batchSize < 5) return false; // too small to judge
  return batchErrors / batchSize > 0.2;
}
