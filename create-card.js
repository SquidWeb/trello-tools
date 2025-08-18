#!/usr/bin/env node
/*
  Create a Trello card with:
  - Title (arg1)
  - Markdown description (arg2 as text, or @path/to/file.md to read from file)
  - Assign current user as member
  - Due date set to today (local noon)
  - List resolved from --list-id, or env TRELLO_DOING_LIST_ID, or by name (--list-name, env DOING_LIST_NAME, default "Doing") on TRELLO_BOARD_ID

  Usage:
    node create-card.js "Title here" "Description in markdown"
    node create-card.js "Title here" @./notes.md
    node create-card.js --list-name "Inbox" "Title" @desc.md

  NPM:
    npm run create-card -- "Title" @desc.md
*/

const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");
const readline = require("readline");
require("dotenv").config();
const { ensureConfig, client, getMe, getListByName } = require("./lib/trello");

const { TRELLO_BOARD_ID, TRELLO_DOING_LIST_ID, DOING_LIST_NAME } = process.env;

function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.includes("=")
        ? a.slice(2).split("=")
        : [
            a.slice(2),
            argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true,
          ];
      flags[k] = v;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

async function resolveListId(flags) {
  if (flags["list-id"]) return flags["list-id"];
  if (TRELLO_DOING_LIST_ID) return TRELLO_DOING_LIST_ID;

  const name = flags["list-name"] || DOING_LIST_NAME || "Doing";
  if (!TRELLO_BOARD_ID)
    throw new Error("Missing TRELLO_BOARD_ID to resolve list by name");
  const list = await getListByName(TRELLO_BOARD_ID, name);
  if (!list)
    throw new Error(
      `Cannot find list named "${name}" on board ${TRELLO_BOARD_ID}`
    );
  return list.id;
}

function readDescription(raw) {
  if (!raw) return "";
  if (raw.startsWith("@")) {
    const fp = path.resolve(process.cwd(), raw.slice(1));
    return fs.readFileSync(fp, "utf8");
  }
  return raw;
}

function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test((answer || "").trim()));
    });
  });
}

function previewText({ listName, listId, title, due, me, description }) {
  const descHead = (description || "").split("\n").slice(0, 6).join("\n");
  const more = (description || "").split("\n").length > 6 ? "\n…" : "";
  return [
    "About to create a Trello card:",
    `- List: ${listName ? `${listName} (${listId})` : listId}`,
    `- Title: ${title}`,
    `- Assign: ${me && me.fullName ? me.fullName : "me"}`,
    `- Due: ${dayjs(due).format("YYYY-MM-DD HH:mm")}`,
    "- Description (head):",
    descHead + more,
  ].join("\n");
}

async function fetchListName(listId) {
  try {
    const { data } = await client.get(`/lists/${listId}`);
    return data && data.name ? data.name : null;
  } catch {
    return null;
  }
}

async function main() {
  try {
    ensureConfig();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const { args, flags } = parseArgs(process.argv);
  const [title, descArg] = args;

  if (!title) {
    console.error(
      'Usage: node create-card.js [--list-id ID | --list-name NAME] "Title" "Description"|@file.md'
    );
    process.exit(1);
  }

  try {
    const listId = await resolveListId(flags);

    const me = await getMe();
    const myId = me.id;

    const description = readDescription(descArg);

    // Due today at local noon to avoid timezone pitfalls
    const due = dayjs()
      .hour(12)
      .minute(0)
      .second(0)
      .millisecond(0)
      .toISOString();

    const listName = await fetchListName(listId);

    // Preview & confirm
    console.log(previewText({ listName, listId, title, due, me, description }));
    if (flags["dry-run"]) {
      console.log("\nDry run: no changes will be made.");
      process.exit(0);
    }

    let proceed = !!flags["yes"];
    if (!proceed) {
      proceed = await promptYesNo("\nCreate this card?");
    }
    if (!proceed) {
      console.log("Aborted.");
      process.exit(0);
    }

    const params = {
      idList: listId,
      name: title,
      desc: description || "",
      due,
      idMembers: myId,
    };

    const { data } = await client.post("/cards", null, { params });

    console.log("\n✅ Created card:");
    console.log(`- ${data.name}`);
    console.log(`- ${data.shortUrl}`);
    console.log(`- due: ${due}`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
