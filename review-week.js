#!/usr/bin/env node
/*
  Review this week's Trello tickets not marked complete and prompt one-by-one to mark complete.
  - Scope: board lists except DONE (by ID or name). Optionally restrict to INCLUDE_LIST_NAMES.
  - Filter: due date within current week (Mon..Sun), not closed, dueComplete=false.
  - For each, prompt to mark as complete. If yes, set dueComplete=true and (optionally) move to DONE list if provided.
  - Flags: --yes (auto-confirm), --dry-run (preview only)
*/

const dayjs = require('dayjs');
require('dotenv').config();
const readline = require('readline');
const {
  ensureConfig,
  getMe,
  getBoardLists,
  getListCards,
  moveCardToList,
  setCardDueComplete,
  resolveDoneListId,
} = require('./lib/trello');

const {
  TRELLO_API_KEY,
  TRELLO_TOKEN,
  TRELLO_BOARD_ID,
  DONE_LIST_ID,
  DONE_LIST_NAME,
  INCLUDE_LIST_NAMES // comma-separated, optional
} = process.env;

function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test((answer || '').trim()));
    });
  });
}

function getWeekRange(now) {
  // Monday 00:00 to Sunday 23:59:59.999 (local)
  const dow = now.day(); // 0=Sun,1=Mon,...
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const start = now.startOf('day').subtract(daysFromMon, 'day');
  const end = start.add(6, 'day').endOf('day');
  return { start, end };
}

async function main() {
  if (!TRELLO_API_KEY || !TRELLO_TOKEN || !TRELLO_BOARD_ID) {
    console.error('Missing Trello configuration. Please set TRELLO_API_KEY, TRELLO_TOKEN and TRELLO_BOARD_ID in your .env');
    process.exit(1);
  }
  // Also ensure helper client is configured
  try { ensureConfig(); } catch (e) { console.error(e.message); process.exit(1); }

  const dryRun = process.argv.includes('--dry-run');
  const autoYes = process.argv.includes('--yes');
  const allMembers = process.argv.includes('--all'); // if set, do not filter to only my cards
  const daysArg = process.argv.find((a) => a.startsWith('--days='));
  const lastNDays = daysArg ? Math.max(1, parseInt(daysArg.split('=')[1], 10) || 0) : 4; // default 4 days

  try {
    const now = dayjs();
    // Window: last N days up to end of today
    const start = now.subtract(lastNDays, 'day').startOf('day');
    const end = now.endOf('day');

    console.log(`📅 Reviewing cards from last ${lastNDays} day(s), due between ${start.format('YYYY-MM-DD')} and ${end.format('YYYY-MM-DD')}`);

    const lists = await getBoardLists(TRELLO_BOARD_ID);
    const doneListId = await resolveDoneListId(lists, DONE_LIST_ID, DONE_LIST_NAME);

    // Determine which lists to include
    // Default to common Doing/Review names if INCLUDE_LIST_NAMES is not set
    let includeNames = null;
    if (INCLUDE_LIST_NAMES && INCLUDE_LIST_NAMES.trim().length > 0) {
      includeNames = INCLUDE_LIST_NAMES.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } else {
      includeNames = ['doing', 'review', 'code review', 'in review'];
    }

    const scopeLists = lists.filter((l) => {
      if (doneListId && l.id === doneListId) return false; // exclude Done
      if (!includeNames || includeNames.length === 0) return true;
      return includeNames.includes((l.name || '').toLowerCase());
    });

    console.log(`📂 Considering ${scopeLists.length}/${lists.length} list(s): ${scopeLists.map((l) => l.name).join(', ')}`);

    // Fetch cards from scope lists
    const allCards = [];
    for (const l of scopeLists) {
      const cards = await getListCards(l.id);
      allCards.push(...cards);
    }
    console.log(`📄 Fetched ${allCards.length} card(s) from scope lists.`);

    // Resolve current user if needed
    let myId = null;
    if (!allMembers) {
      const me = await getMe();
      myId = me.id;
      console.log(`👤 Filtering to cards assigned to you (${me.username}). Use --all to include unassigned/others.`);
    } else {
      console.log('👥 Including cards assigned to any member (--all).');
    }

    // Filter this week's, not closed, not dueComplete
    const candidates = allCards.filter((c) => {
      if (c.closed) return false;
      if (c.dueComplete) return false;
      if (!c.due) return false;
      const due = dayjs(c.due);
      const inWindow = (due.isAfter(start) || due.isSame(start)) && (due.isBefore(end) || due.isSame(end));
      const mine = allMembers ? true : (Array.isArray(c.idMembers) && c.idMembers.includes(myId));
      return inWindow && mine;
    });

    if (candidates.length === 0) {
      console.log('✅ No matching incomplete cards in the selected window.');
      process.exit(0);
    }

    console.log('📝 Incomplete cards to review:');
    candidates.forEach((c) => console.log(`- ${c.name} (${c.url}) | due: ${c.due}`));

    if (dryRun) {
      console.log('\nDry run: no changes will be made.');
      process.exit(0);
    }

    for (const c of candidates) {
      let doComplete = autoYes;
      if (!autoYes) {
        const resp = await promptYesNo(`Mark complete -> ${c.name}?`);
        doComplete = resp;
      }
      if (doComplete) {
        await setCardDueComplete(c.id, true);
        if (doneListId && c.idList !== doneListId) {
          await moveCardToList(c.id, doneListId);
        }
        console.log(`✅ Marked complete: ${c.name}`);
      } else {
        console.log(`⏭️  Skipped: ${c.name}`);
      }
    }

    console.log('🎉 Done.');
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
