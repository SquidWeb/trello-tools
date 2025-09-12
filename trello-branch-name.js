#!/usr/bin/env node
/*
  trello-branch-name.js
  Given a Trello card URL (short or full), print the numeric ticket id (idShort) for git branch naming.

  Examples:
    Full:  https://trello.com/c/HeU8mIgO/9614-command-palette-quick-nav-tabs-switcher-experimental -> 9614
    Short: https://trello.com/c/HeU8mIgO -> resolves via Trello API to idShort (e.g., 9614)

  Usage:
    node trello-branch-name.js <TRELLO_CARD_URL>

  NPM script (after package.json update):
    npm run trello-branch -- <TRELLO_CARD_URL>
*/

const { ensureConfig, client } = require('./lib/trello');
const { spawn } = require('child_process');

function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '') // remove non-alnum (keep spaces and hyphens)
    .trim()
    .replace(/[\s_-]+/g, '-')     // collapse separators to single '-'
    .replace(/^-+|-+$/g, '');      // trim leading/trailing '-'
}

async function extractTicketId(inputUrl) {
  let u;
  try {
    u = new URL(inputUrl);
  } catch (e) {
    throw new Error(`Invalid URL: ${inputUrl}`);
  }

  const parts = u.pathname.split('/').filter(Boolean);
  // Accept card URLs that start with /c
  if (parts[0] !== 'c') {
    throw new Error('URL does not look like a Trello card URL (expected path starting with /c/...).');
  }

  // Full form: /c/<short>/<number>-slug
  if (parts.length >= 3) {
    // Return the entire slug segment (e.g., 9614-some-title)
    return parts[2];
  }

  // Short form: /c/<short>
  if (parts.length === 2) {
    ensureConfig();
    const shortLink = parts[1];
    // Query Trello for card by shortLink: /cards/{shortLink}
    const { data } = await client.get(`/cards/${shortLink}`, { params: { fields: 'idShort,name' } });
    if (!data || typeof data.idShort === 'undefined') {
      throw new Error('Unable to resolve idShort from Trello API.');
    }
    const slug = `${data.idShort}-${slugifyName(data.name)}`;
    return slug;
  }

  throw new Error('Unrecognized Trello card URL format.');
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node trello-branch-name.js <TRELLO_CARD_URL>');
    process.exit(1);
  }

  try {
    const id = await extractTicketId(arg);
    console.log(id);
    
    // Copy to clipboard without blocking: spawn a detached shell and unref it.
    // We pass the content via an env var to avoid shell escaping issues.
    const fireAndForget = (cmd) => {
      const child = spawn('sh', ['-c', cmd], {
        env: { ...process.env, CLIP_CONTENT: id },
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    };

    // Try wl-copy first (Wayland), then fallback to xclip (X11)
    // Using env var: printf %s "$CLIP_CONTENT" | wl-copy
    try {
      fireAndForget('printf %s "$CLIP_CONTENT" | wl-copy');
      console.log(`Branch name copied to clipboard: ${id}`);
    } catch (wlErr) {
      try {
        fireAndForget('printf %s "$CLIP_CONTENT" | xclip -selection clipboard');
        console.log(`Branch name copied to clipboard: ${id}`);
      } catch (xclipErr) {
        console.error('Note: Could not copy to clipboard. Install wl-clipboard (Wayland) or xclip (X11) for automatic copying.');
      }
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { extractTicketId };
