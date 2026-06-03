#!/usr/bin/env bun
/**
 * Social fan-out. Collects every adapter whose credentials are present and
 * shares to all of them. Used programmatically (shareToSocial) by the approval
 * flow, and as a CLI for verifying credentials / sending a test post.
 *
 * CLI:
 *   bun run scripts/news-agent/share.ts --verify        # read-only auth check (no posts)
 *   bun run scripts/news-agent/share.ts --test          # post a harmless test to ALL enabled platforms (PUBLIC)
 *   bun run scripts/news-agent/share.ts --test --only bluesky
 */
import { bluesky } from './social/bluesky';
import { mastodon } from './social/mastodon';
import { reddit } from './social/reddit';
import { pinterest } from './social/pinterest';
import { tumblr } from './social/tumblr';
import type { ShareInput, ShareResult, SocialAdapter, VerifyResult } from './social/types';

// Every adapter is credential-gated (off until its *_ env creds are set).
// Meta/IG intentionally omitted for now (Phase 2b — needs the Graph API + business account).
const ADAPTERS: SocialAdapter[] = [bluesky, mastodon, reddit, pinterest, tumblr];

function selected(onlyArg?: string): SocialAdapter[] {
  const enabled = ADAPTERS.filter((a) => a.enabled);
  if (!onlyArg) return enabled;
  const wanted = new Set(onlyArg.split(',').map((s) => s.trim().toLowerCase()));
  return enabled.filter((a) => wanted.has(a.platform));
}

/** Share to every configured platform (or a subset). Errors are captured per-platform. */
export async function shareToSocial(input: ShareInput, only?: string): Promise<ShareResult[]> {
  const targets = selected(only);
  return Promise.all(targets.map((a) => a.share(input)));
}

/** Read-only credential check across all configured platforms. */
export async function verifyAll(only?: string): Promise<VerifyResult[]> {
  const targets = selected(only);
  return Promise.all(targets.map((a) => a.verify()));
}

// ── CLI ──────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv;
  const has = (f: string) => argv.includes(f);
  const flag = (n: string) => {
    const i = argv.indexOf(n);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const only = flag('--only');

  console.log('\nConfigured adapters:',
    ADAPTERS.map((a) => `${a.platform}${a.enabled ? '✓' : ' (no creds)'}`).join('  '), '\n');

  if (has('--verify')) {
    const results = await verifyAll(only);
    if (results.length === 0) { console.log('No adapters have credentials set.'); return; }
    for (const r of results) {
      console.log(r.ok ? `  ✓ ${r.platform.padEnd(9)} ${r.account}` : `  ✗ ${r.platform.padEnd(9)} ${r.error}`);
    }
    return;
  }

  if (has('--test')) {
    const input: ShareInput = {
      title: flag('--message') || 'Male Q news feed test post — automated setup check. 🏳️‍🌈',
      excerpt: 'Verifying our automated LGBTQ news posting. Thanks for your patience!',
      url: flag('--url') || 'https://maleq.com',
      socialText: flag('--message') || 'Testing our automated LGBTQ news feed, back to your regularly scheduled headlines shortly.',
      hashtags: ['LGBTQ', 'QueerNews'],
    };
    console.log(`Posting TEST to: ${selected(only).map((a) => a.platform).join(', ') || '(none)'}\n`);
    const results = await shareToSocial(input, only);
    for (const r of results) {
      console.log(r.ok ? `  ✓ ${r.platform.padEnd(9)} ${r.url || 'posted'}` : `  ✗ ${r.platform.padEnd(9)} ${r.error}`);
    }
    return;
  }

  console.log('Usage: --verify | --test [--only bluesky,mastodon] [--message "…"] [--url "…"]');
}

if (import.meta.main) {
  main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
}
