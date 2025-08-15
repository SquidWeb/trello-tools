#!/usr/bin/env node
/*
  Update Trello due dates for cards in the Doing list assigned to the current user.
  - Finds the Doing list (by TRELLO_DOING_LIST_ID, or by name on TRELLO_BOARD_ID)
  - Filters cards assigned to you with due date before today
  - Shows a preview and asks for confirmation (use --yes to skip)
  - Updates due date to today (local noon) to avoid timezone pitfalls
*/

const axios = require('axios');
const dayjs = require('dayjs');
const readline = require('readline');
require('dotenv').config();

const { TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID, TRELLO_DOING_LIST_ID, DOING_LIST_NAME } = process.env;

function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test((answer || '').trim()));
    });
  });
}

async function getMe() {
  const url = `https://api.trello.com/1/members/me`;
  const { data } = await axios.get(url, { params: { key: TRELLO_API_KEY, token: TRELLO_TOKEN } });
  return data;
}

async function getDoingListId() {
  if (TRELLO_DOING_LIST_ID) return TRELLO_DOING_LIST_ID;
  if (!TRELLO_BOARD_ID) throw new Error('Missing TRELLO_BOARD_ID or TRELLO_DOING_LIST_ID in .env');
  const listsUrl = `https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/lists`;
  const { data: lists } = await axios.get(listsUrl, { params: { key: TRELLO_API_KEY, token: TRELLO_TOKEN, cards: 'none' } });
  const name = (DOING_LIST_NAME || 'Doing').toLowerCase();
  const list = lists.find((l) => (l.name || '').toLowerCase() === name);
  if (!list) throw new Error(`Cannot find list named "${DOING_LIST_NAME || 'Doing'}" on board ${TRELLO_BOARD_ID}`);
  return list.id;
}

async function getCardsInList(listId) {
  const url = `https://api.trello.com/1/lists/${listId}/cards`;
  const { data } = await axios.get(url, { params: { key: TRELLO_API_KEY, token: TRELLO_TOKEN, fields: 'name,due,idMembers,url' } });
  return data;
}

function isPastDueButNotToday(dueIso, now) {
  if (!dueIso) return false;
  const due = dayjs(dueIso);
  // Compare by date (YYYY-MM-DD)
  const dueDate = due.format('YYYY-MM-DD');
  const today = now.format('YYYY-MM-DD');
  return due.isBefore(now, 'day') && dueDate !== today;
}

async function updateCardDue(cardId, newDueIso) {
  const url = `https://api.trello.com/1/cards/${cardId}`;
  const { data } = await axios.put(url, null, { params: { key: TRELLO_API_KEY, token: TRELLO_TOKEN, due: newDueIso } });
  return data;
}

async function main() {
  if (!TRELLO_API_KEY || !TRELLO_TOKEN) {
    console.error('Missing Trello configuration. Please set TRELLO_API_KEY and TRELLO_TOKEN in your .env');
    process.exit(1);
  }

  const now = dayjs();
  const dryRun = process.argv.includes('--dry-run');
  const autoYes = process.argv.includes('--yes');

  try {
    console.log('🔎 Resolving current user...');
    const me = await getMe();
    const myId = me.id;

    console.log('📂 Resolving Doing list...');
    const listId = await getDoingListId();

    console.log('📄 Fetching cards in Doing...');
    const cards = await getCardsInList(listId);

    const candidates = cards.filter((c) => Array.isArray(c.idMembers) && c.idMembers.includes(myId) && isPastDueButNotToday(c.due, now));

    if (candidates.length === 0) {
      console.log('✅ No assigned cards in Doing with past due date.');
      process.exit(0);
    }

    // Split by age: older than 7 days vs within last 7 days
    const aWeekAgo = now.subtract(7, 'day');
    const tooOld = [];
    const recent = [];
    for (const c of candidates) {
      const due = dayjs(c.due);
      if (due.isBefore(aWeekAgo, 'day')) tooOld.push(c); else recent.push(c);
    }

    if (tooOld.length > 0) {
      console.log('⏭️  Ignoring cards older than a week (listed only):');
      tooOld.forEach((c) => console.log(`- ${c.name} (${c.url}) | due: ${c.due}`));
      console.log('');
    }

    if (recent.length === 0) {
      console.log('✅ No cards from the last week require updates.');
      process.exit(0);
    }

    console.log('📝 Candidates from last week to move to today:');
    recent.forEach((c) => console.log(`- ${c.name} (${c.url}) | due: ${c.due}`));

    if (dryRun) {
      console.log('\nDry run: no changes will be made.');
      process.exit(0);
    }

    // Non-overlapping times: schedule sequential slots today
    // Start from today 09:00 local (or next 5-min slot after now if it's already later)
    let slot = now.hour(9).minute(0).second(0).millisecond(0);
    if (slot.isBefore(now)) {
      const next5 = Math.ceil(now.minute() / 5) * 5;
      slot = now.minute(next5).second(0).millisecond(0);
    }
    const incrementMinutes = 15; // space items 15 minutes apart

    for (const c of recent) {
      const targetDue = slot.toISOString();
      let doUpdate = autoYes;
      if (!autoYes) {
        const resp = await promptYesNo(`Update to today ${slot.format('HH:mm')} -> ${c.name}?`);
        doUpdate = resp;
      }
      if (doUpdate) {
        await updateCardDue(c.id, targetDue);
        console.log(`✅ Updated due for: ${c.name} -> ${slot.format('YYYY-MM-DD HH:mm')}`);
        slot = slot.add(incrementMinutes, 'minute');
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
