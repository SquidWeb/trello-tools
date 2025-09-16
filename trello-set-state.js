#!/usr/bin/env node
/*
  Trello state setter
  - Move a card to Review or Rejected list (optional)
  - Toggle dueComplete true/false (used by Planyway in many setups)
  - Verbose logs and --dry-run support

  Usage:
    node trello-set-state.js --card <trello_card_url_or_id> --to review --complete true [--yes] [--dry-run]
    node trello-set-state.js --card <trello_card_url_or_id> --to rejected --complete false [--yes] [--dry-run]
    node trello-set-state.js --card <trello_card_url_or_id> --complete true [--yes] [--dry-run]
    node trello-set-state.js --card <trello_card_url_or_id> --complete false [--yes] [--dry-run]
*/

require('dotenv').config();
const readline = require('readline');
const {
  ensureConfig,
  getBoardLists,
  getListByName,
  moveCardToList,
  setCardDueComplete,
  getCard,
} = require('./lib/trello');

const {
  TRELLO_BOARD_ID,
  REVIEW_LIST_ID,
  REVIEW_LIST_NAME,
  REJECTED_LIST_ID,
  REJECTED_LIST_NAME,
} = process.env;

function parseArgs(argv) {
  const args = { raw: argv.slice(2) };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--card') args.card = argv[++i];
    else if (a === '--to') args.to = (argv[++i] || '').toLowerCase();
    else if (a === '--complete') args.complete = (argv[++i] || '').toLowerCase();
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes') args.autoYes = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printUsage() {
  console.log(`\nTrello state setter\n\n` +
`Examples:\n  node trello-set-state.js --card <card_url_or_id> --to review --complete true --yes\n  node trello-set-state.js --card <card_url_or_id> --to rejected --complete false --dry-run\n  node trello-set-state.js --card <card_url_or_id> --complete true --yes\n  node trello-set-state.js --card <card_url_or_id> --complete false --dry-run\n`);
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

function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test((answer || '').trim()));
    });
  });
}

async function resolveTargetListId(target) {
  if (target === 'review') {
    if (REVIEW_LIST_ID) return REVIEW_LIST_ID;
    if (!TRELLO_BOARD_ID) throw new Error('Set REVIEW_LIST_ID or provide TRELLO_BOARD_ID to resolve REVIEW_LIST_NAME');
    const list = await getListByName(TRELLO_BOARD_ID, REVIEW_LIST_NAME || 'Review');
    if (!list) throw new Error(`Cannot find list named "${REVIEW_LIST_NAME || 'Review'}" on board ${TRELLO_BOARD_ID}`);
    return list.id;
  }
  if (target === 'rejected') {
    if (REJECTED_LIST_ID) return REJECTED_LIST_ID;
    if (!TRELLO_BOARD_ID) throw new Error('Set REJECTED_LIST_ID or provide TRELLO_BOARD_ID to resolve REJECTED_LIST_NAME');
    const list = await getListByName(TRELLO_BOARD_ID, REJECTED_LIST_NAME || 'Rejected');
    if (!list) throw new Error(`Cannot find list named "${REJECTED_LIST_NAME || 'Rejected'}" on board ${TRELLO_BOARD_ID}`);
    return list.id;
  }
  throw new Error(`Unknown --to value: ${target}. Use 'review' or 'rejected'.`);
}

async function main() {
  try { ensureConfig(); } catch (e) { console.error(e.message); process.exit(1); }
  const args = parseArgs(process.argv);
  if (args.help || !args.card || (!args.to && !args.complete)) { printUsage(); process.exit(0); }

  const cardId = extractCardId(args.card);
  const target = args.to;

  const completeFlag = (args.complete === 'true') ? true : (args.complete === 'false') ? false : null;
  if (completeFlag === null && !target) {
    console.log('ℹ️  No --complete flag provided; will only move list. You can pass --complete true|false to also toggle dueComplete.');
  }

  try {
    // First, fetch the card to show its title
    const card = await getCard(cardId, ['name', 'idList']);
    console.log(`\n📋 Card: ${card.name} (ID: ${cardId})`);
    
    let listId = null;
    if (target) {
      listId = await resolveTargetListId(target);
    }

    console.log(`\nPlanned changes:`);
    if (target) {
      console.log(`— Move to list: ${target} (id ${listId})`);
    }
    if (completeFlag !== null) console.log(`— Set dueComplete: ${completeFlag}`);

    if (args.dryRun) {
      console.log('\nDry run: no changes will be made.');
      process.exit(0);
    }

    let proceed = args.autoYes;
    if (!proceed) {
      proceed = await promptYesNo('Proceed?');
    }
    if (!proceed) { console.log('Aborted.'); process.exit(0); }

    if (target) {
      await moveCardToList(cardId, listId);
    }
    if (completeFlag !== null) {
      await setCardDueComplete(cardId, completeFlag);
    }

    console.log('✅ Done.');
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
