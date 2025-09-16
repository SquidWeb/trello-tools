#!/usr/bin/env node
/*
  Planyway inspector for Trello cards
  - Fetches Trello card data including pluginData and customFieldItems
  - Decodes/prints Planyway-related pluginData payloads (JSON where possible)
  - Can inspect a single card by URL/ID or scan a whole board

  Usage:
    node planyway-inspect.js --card <trello_card_url_or_id>
    node planyway-inspect.js --board <trello_board_id> [--limit 50]

  Notes:
  - Planyway stores state in Trello pluginData (Power-Up storage). There is no Planyway API.
  - We print raw pluginData entries and attempt to parse the 'value' as JSON for readability.
  - Outputs are also saved to planyway-inspect-outputs/*.json for offline inspection.
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  ensureConfig,
  client,
  getCardFull,
  getBoardCardsWithPluginData,
} = require('./lib/trello');

function parseArgs(argv) {
  const args = { raw: argv.slice(2) };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--card') args.card = argv[++i];
    else if (a === '--board') args.board = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10) || 50;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printUsage() {
  console.log(`\nPlanyway inspector for Trello\n\n` +
`Inspect a single card:\n  node planyway-inspect.js --card <trello_card_url_or_id>\n\n` +
`Scan a board (quick overview):\n  node planyway-inspect.js --board <trello_board_id> [--limit 50]\n`);
}

function ensureOutputDir() {
  const outDir = path.resolve(process.cwd(), 'planyway-inspect-outputs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

function extractCardId(input) {
  if (!input) return null;
  // Accept either full URL like https://trello.com/c/SHORT/123-card or raw id/shortLink
  try {
    if (/^https?:\/\//i.test(input)) {
      const u = new URL(input);
      const parts = u.pathname.split('/').filter(Boolean);
      // URL formats: /c/<shortLink>/<slug> or /card/<id>
      const idx = parts.findIndex((p) => p === 'c' || p === 'card');
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    }
  } catch (_) { /* ignore */ }
  return input;
}

function prettyParse(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return value; }
  }
  return value;
}

function safeWriteJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function tryFindPlanywayPluginIds(pluginData = []) {
  // We don't know Planyway's plugin id. We can guess by keys present in value or idPlugin observed repeatedly.
  // Strategy: group by idPlugin and show sample keys for each.
  const map = new Map();
  for (const p of pluginData) {
    const list = map.get(p.idPlugin) || [];
    list.push(p);
    map.set(p.idPlugin, list);
  }
  const hints = [];
  for (const [idPlugin, list] of map.entries()) {
    const sample = list[0];
    const parsed = prettyParse(sample.value);
    const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 10) : [];
    hints.push({ idPlugin, count: list.length, sampleKeys: keys });
  }
  return hints.sort((a, b) => b.count - a.count);
}

async function inspectCard(cardInput) {
  const outDir = ensureOutputDir();
  const cardId = extractCardId(cardInput);
  console.log(`\n🔎 Inspecting card: ${cardInput} -> id/shortLink: ${cardId}`);

  const card = await getCardFull(cardId, ['id','name','desc','url','due','dueComplete','idList','idMembers']);

  // Fallback direct pluginData endpoint (sometimes includes more fields)
  let pluginData = Array.isArray(card.pluginData) ? card.pluginData : [];
  try {
    const { data } = await client.get(`/cards/${card.id}/pluginData`);
    if (Array.isArray(data) && data.length) pluginData = data;
  } catch (e) {
    // not fatal
  }

  const decoded = pluginData.map((p) => ({
    id: p.id,
    idPlugin: p.idPlugin,
    scope: p.scope,
    idModel: p.idModel,
    valueRaw: p.value,
    value: prettyParse(p.value),
  }));

  const summary = {
    card: {
      id: card.id,
      shortUrl: card.shortUrl || card.url,
      name: card.name,
      idList: card.idList,
      due: card.due,
      dueComplete: card.dueComplete,
    },
    pluginDataSummary: tryFindPlanywayPluginIds(pluginData),
    pluginData: decoded,
    customFieldItems: card.customFieldItems || [],
  };

  console.log('— Card:', summary.card);
  console.log('— pluginData groups (by idPlugin):', summary.pluginDataSummary);
  const outfile = path.join(outDir, `card-${card.id}.json`);
  safeWriteJson(outfile, summary);
  console.log(`📦 Wrote detailed output -> ${outfile}`);

  // Try to find likely Planyway entries and print them nicely
  const likely = summary.pluginDataSummary[0];
  if (likely) {
    const entries = decoded.filter((d) => d.idPlugin === likely.idPlugin);
    console.log(`\nTop plugin id ${likely.idPlugin} (${likely.count} entries). Sample parsed values:`);
    for (const e of entries.slice(0, 5)) {
      console.log('—', typeof e.value === 'object' ? JSON.stringify(e.value, null, 2) : e.value);
    }
  }
}

async function scanBoard(boardId, limit = 50) {
  console.log(`\n📋 Scanning board ${boardId} (limit ${limit}) for cards with pluginData...`);
  const cards = await getBoardCardsWithPluginData(boardId, ['id','name','shortUrl','idList','dateLastActivity']);
  const withPD = cards.filter((c) => Array.isArray(c.pluginData) && c.pluginData.length > 0);
  const sorted = withPD.sort((a, b) => new Date(b.dateLastActivity) - new Date(a.dateLastActivity));
  const pick = sorted.slice(0, limit);
  console.log(`Found ${withPD.length}/${cards.length} cards with pluginData. Showing ${pick.length}.`);

  const outDir = ensureOutputDir();
  const outline = pick.map((c) => ({ id: c.id, shortUrl: c.shortUrl, name: c.name, pluginDataCount: c.pluginData.length }));
  const outfile = path.join(outDir, `board-${boardId}-overview.json`);
  safeWriteJson(outfile, outline);
  console.log(`📦 Wrote overview -> ${outfile}`);

  // Show minimal console view
  for (const c of pick) {
    const hints = tryFindPlanywayPluginIds(c.pluginData);
    console.log(`— ${c.name} | ${c.shortUrl} | plugin ids: ${hints.map(h => `${h.idPlugin}(${h.count})`).join(', ')}`);
  }
}

async function main() {
  try {
    ensureConfig();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  if (args.help || (!args.card && !args.board)) {
    printUsage();
    process.exit(0);
  }

  try {
    if (args.card) {
      await inspectCard(args.card);
    } else if (args.board) {
      await scanBoard(args.board, args.limit || 50);
    }
    console.log('\n✅ Done.');
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    if (err.response && err.response.data) {
      console.error('Trello response:', JSON.stringify(err.response.data));
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
