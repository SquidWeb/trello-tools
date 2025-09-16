#!/usr/bin/env node
/*
  Planyway watcher for Trello card pluginData changes
  - Polls a single Trello card periodically and diffs pluginData/customFieldItems
  - Helps reverse-engineer which values Planyway toggles when marking complete/incomplete

  Usage:
    node planyway-watch.js --card <trello_card_url_or_id> [--interval 5]
*/

require('dotenv').config();
const crypto = require('crypto');
const {
  ensureConfig,
  client,
  getCardFull,
} = require('./lib/trello');

function parseArgs(argv) {
  const args = { raw: argv.slice(2), interval: 5 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--card') args.card = argv[++i];
    else if (a === '--interval') args.interval = Math.max(1, parseInt(argv[++i], 10) || 5);
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printUsage() {
  console.log(`\nPlanyway watcher for Trello\n\n` +
`Watch a card and print diffs:\n  node planyway-watch.js --card <trello_card_url_or_id> [--interval 5]\n`);
}

function extractCardId(input) {
  if (!input) return null;
  try {
    if (/^https?:\/\//i.test(input)) {
      const u = new URL(input);
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex((p) => p === 'c' || p === 'card');
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    }
  } catch (_) { /* ignore */ }
  return input;
}

function stableStringify(obj) {
  // Deterministic stringify for diff hashing
  return JSON.stringify(obj, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce((acc, k) => { acc[k] = value[k]; return acc; }, {});
    }
    return value;
  });
}

function hash(val) {
  return crypto.createHash('sha1').update(val).digest('hex');
}

function normalizePluginData(list = []) {
  return list.map((p) => ({
    id: p.id,
    idPlugin: p.idPlugin,
    scope: p.scope,
    idModel: p.idModel,
    value: p.value,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchSnapshot(cardId) {
  const card = await getCardFull(cardId, ['id','name','url','due','dueComplete','idList']);
  // Some fields are not included unless fetched directly
  let pluginData = Array.isArray(card.pluginData) ? card.pluginData : [];
  try {
    const { data } = await client.get(`/cards/${card.id}/pluginData`);
    if (Array.isArray(data) && data.length) pluginData = data;
  } catch (_) {}

  const normalized = {
    meta: { id: card.id, name: card.name, url: card.shortUrl || card.url, dueComplete: card.dueComplete, idList: card.idList },
    pluginData: normalizePluginData(pluginData),
    customFieldItems: (card.customFieldItems || []).slice().sort((a, b) => (a.id || '').localeCompare(b.id || '')),
  };
  const digest = hash(stableStringify(normalized));
  return { normalized, digest };
}

function diffArrays(prevArr, nextArr, keyFn) {
  const prevMap = new Map(prevArr.map((x) => [keyFn(x), x]));
  const nextMap = new Map(nextArr.map((x) => [keyFn(x), x]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, v] of nextMap.entries()) {
    if (!prevMap.has(k)) added.push(v);
    else {
      const pv = prevMap.get(k);
      if (JSON.stringify(pv) !== JSON.stringify(v)) changed.push({ before: pv, after: v });
    }
  }
  for (const [k, v] of prevMap.entries()) {
    if (!nextMap.has(k)) removed.push(v);
  }
  return { added, removed, changed };
}

async function main() {
  try { ensureConfig(); } catch (e) { console.error(e.message); process.exit(1); }
  const args = parseArgs(process.argv);
  if (args.help || !args.card) { printUsage(); process.exit(0); }

  const cardId = extractCardId(args.card);
  console.log(`\n👀 Watching card ${args.card} -> ${cardId}. Press Ctrl+C to stop.`);

  let prev = null;
  while (true) {
    try {
      const snap = await fetchSnapshot(cardId);
      if (!prev) {
        console.log('Initial snapshot:', snap.normalized.meta);
        console.log(`pluginData entries: ${snap.normalized.pluginData.length}, customFieldItems: ${snap.normalized.customFieldItems.length}`);
        prev = snap;
      } else if (snap.digest !== prev.digest) {
        console.log(`\n🔔 Change detected at ${new Date().toLocaleTimeString()}`);
        if (snap.normalized.meta.dueComplete !== prev.normalized.meta.dueComplete) {
          console.log(`— dueComplete: ${prev.normalized.meta.dueComplete} -> ${snap.normalized.meta.dueComplete}`);
        }
        if (snap.normalized.meta.idList !== prev.normalized.meta.idList) {
          console.log(`— idList: ${prev.normalized.meta.idList} -> ${snap.normalized.meta.idList}`);
        }
        const pd = diffArrays(prev.normalized.pluginData, snap.normalized.pluginData, (x) => x.id);
        const cf = diffArrays(prev.normalized.customFieldItems, snap.normalized.customFieldItems, (x) => x.id || `${x.idCustomField}:${x.idValue}`);
        if (pd.added.length || pd.removed.length || pd.changed.length) {
          console.log(`— pluginData diff: +${pd.added.length} -${pd.removed.length} ~${pd.changed.length}`);
          if (pd.added.length) console.log('  added:', pd.added);
          if (pd.removed.length) console.log('  removed:', pd.removed);
          if (pd.changed.length) console.log('  changed:', pd.changed);
        }
        if (cf.added.length || cf.removed.length || cf.changed.length) {
          console.log(`— customFieldItems diff: +${cf.added.length} -${cf.removed.length} ~${cf.changed.length}`);
          if (cf.added.length) console.log('  added:', cf.added);
          if (cf.removed.length) console.log('  removed:', cf.removed);
          if (cf.changed.length) console.log('  changed:', cf.changed);
        }
        prev = snap;
      }
    } catch (err) {
      console.error('Watch error:', err.message);
    }
    await new Promise((r) => setTimeout(r, args.interval * 1000));
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
