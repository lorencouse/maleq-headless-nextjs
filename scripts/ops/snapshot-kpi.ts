#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Json = Record<string, unknown>;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function fetchJson(url: string, token: string): Promise<Json> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Request failed (${response.status}) for ${url}. Response: ${text.slice(0, 300)}`
    );
  }

  try {
    return JSON.parse(text) as Json;
  } catch {
    throw new Error(`Invalid JSON response from ${url}`);
  }
}

function makeTimestamp(): string {
  return new Date().toISOString().replace(/[:]/g, '-');
}

async function main(): Promise<void> {
  const token = requiredEnv('ADMIN_API_KEY');
  const baseUrl = (process.env.KPI_BASE_URL || 'https://maleq.com').replace(/\/$/, '');
  const sinceHours = Number.parseInt(process.env.KPI_SINCE_HOURS || '24', 10);
  const includeEvents = process.env.KPI_INCLUDE_EVENTS === '1';
  const outputDir = process.env.KPI_OUTPUT_DIR || 'audit-inputs/kpi-snapshots';
  const timestamp = makeTimestamp();

  const summaryUrl = `${baseUrl}/api/admin/events/summary?sinceHours=${sinceHours}`;
  const summary = await fetchJson(summaryUrl, token);

  const envelope: Json = {
    capturedAt: new Date().toISOString(),
    baseUrl,
    sinceHours,
    summary,
  };

  if (includeEvents) {
    const eventsUrl = `${baseUrl}/api/admin/events?limit=200&sinceHours=${sinceHours}&includePayload=1`;
    envelope.events = await fetchJson(eventsUrl, token);
  }

  await mkdir(outputDir, { recursive: true });
  const filename = path.join(outputDir, `${timestamp}.json`);
  await writeFile(filename, JSON.stringify(envelope, null, 2), 'utf8');

  console.log(`Saved KPI snapshot: ${filename}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`KPI snapshot failed: ${message}`);
  process.exit(1);
});
