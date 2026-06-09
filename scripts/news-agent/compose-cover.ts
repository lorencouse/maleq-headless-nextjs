#!/usr/bin/env bun
/**
 * Tiny pure helper for the WP cover-picker meta box: download an image URL, apply
 * the standard headline overlay, write an optimized WebP to a temp file, and print
 * its path (the ONLY thing on stdout, so the PHP caller can read it). Exits non-zero
 * with no path on any failure, so the caller can fall back to importing the raw URL.
 *
 * No DB, no wp-cli — just the image pipeline in images.ts, so it's safe and fast to
 * exec from a PHP-FPM web request.
 *
 * Usage:
 *   bun run scripts/news-agent/compose-cover.ts --url <url> --slug <slug> [--headline "TEXT"]
 */
import { downloadWebp } from './images';

const argv = process.argv;
const flag = (n: string) => { const i = argv.indexOf(n); return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined; };

const url = flag('--url');
const slug = flag('--slug') || 'cover';
const headline = flag('--headline') || undefined;

if (!url) { console.error('compose-cover: --url is required'); process.exit(2); }

const out = await downloadWebp(url, slug, headline);
if (!out) { console.error('compose-cover: download/compose failed'); process.exit(1); }
process.stdout.write(out); // the temp path, nothing else
