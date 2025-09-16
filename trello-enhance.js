#!/usr/bin/env node
/*
CLI: Enhance Trello card descriptions (and optionally titles) using an LLM via OpenRouter.

Workflow:
  1) Finds your recently created cards on a Trello board
  2) Detects cards with missing/short descriptions
  3) Shows title + current description and asks whether to generate a suggestion
  4) Generates suggestion with OpenRouter (cheap model by default)
  5) Asks for approval to apply; updates the card if approved
  6) Caches processed/decided cards to avoid reprocessing and reduce LLM cost

Usage examples:
  # Default dry-run; scans last 48 hours
  TRELLO_API_KEY=... TRELLO_TOKEN=... TRELLO_BOARD_ID=... OPENROUTER_API_KEY=... \
  trello-enhance --hours 48

  # Actually apply updates (still asks for approval per card)
  trello-enhance --apply

Options:
  --hours <n>               Look back N hours for created cards (default: 48)
  --min-desc-chars <n>      Threshold below which a description is considered short (default: 60)
  --model <name>            OpenRouter model (default: "mistralai/mistral-small-3.2-24b-instruct:free")
  --max-cards <n>           Limit how many cards to consider per run (default: 15)
  --apply                   Actually apply changes to Trello (default: false = dry-run)
  --no-title                Do not suggest title enhancements
  --force                   Ignore local cache and reconsider cards
  --list-only               Only list candidate cards, do not generate or update
  --merge <prepend|append|replace>   How to merge AI suggestion with existing description (default: prepend)
  --help                    Show this help

Environment:
  TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID
  OPENROUTER_API_KEY

Cache:
  .cache/trello-enhancer.json (in repo root) stores processed cards to avoid repeated LLM calls/updates.
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const { ensureConfig, getMe, getBoardCards, getBoardLists, client } = require('./lib/trello');

// Ensure global fetch exists (Node < 18)
if (typeof fetch !== 'function') {
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const headers = opts.headers || {};
    const body = opts.body;
    const data = body
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : undefined;
    const res = await axios({ url, method, headers, data, validateStatus: () => true });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.data,
      text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
    };
  };
}

function parseArgs(argv) {
  const out = {
    hours: 48,
    minDescChars: 60,
    model: "mistralai/mistral-small-3.2-24b-instruct:free",
    maxCards: 15,
    apply: false,
    title: true,
    force: false,
    listOnly: false,
    merge: "prepend", // prepend | append | replace
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--hours" && argv[i + 1]) {
      out.hours = Number(argv[++i]);
      continue;
    }
    if (a === "--min-desc-chars" && argv[i + 1]) {
      out.minDescChars = Number(argv[++i]);
      continue;
    }
    if (a === "--model" && argv[i + 1]) {
      out.model = String(argv[++i]);
      continue;
    }
    if (a === "--max-cards" && argv[i + 1]) {
      out.maxCards = Number(argv[++i]);
      continue;
    }
    if (a === "--apply") {
      out.apply = true;
      continue;
    }
    if (a === "--no-title") {
      out.title = false;
      continue;
    }
    if (a === "--force") {
      out.force = true;
      continue;
    }
    if (a === "--list-only") {
      out.listOnly = true;
      continue;
    }
    if (a === "--merge" && argv[i + 1]) {
      const m = String(argv[++i]).toLowerCase();
      if (m === "prepend" || m === "append" || m === "replace") out.merge = m;
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  const start = fs.readFileSync(__filename, 'utf8').split('\n');
  console.log(start.slice(0, 33).join('\n'));
}

function ensureCachePath() {
  const root = process.cwd();
  const cacheDir = path.join(root, ".cache");
  const cacheFile = path.join(cacheDir, "trello-enhancer.json");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(cacheFile)) fs.writeFileSync(cacheFile, "{}", "utf8");
  return cacheFile;
}

function loadCache() {
  try {
    const file = ensureCachePath();
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  const file = ensureCachePath();
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), "utf8");
}

function sha1(str) {
  // Lightweight hash to detect desc changes; not crypto-strong (avoid extra deps)
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

async function promptYesNo(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      const a = String(answer || "")
        .trim()
        .toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}

// Trello helpers now come from lib/trello via axios client
async function fetchBoardCreateActionsViaClient(boardId, sinceISO) {
  ensureConfig();
  const { data } = await client.get(`/boards/${boardId}/actions`, {
    params: { filter: 'createCard', limit: 1000, ...(sinceISO ? { since: sinceISO } : {}) },
  });
  return data;
}

async function updateCardViaClient(cardId, { name, desc }) {
  ensureConfig();
  const params = {};
  if (typeof name === 'string') params.name = name;
  if (typeof desc === 'string') params.desc = desc;
  const { data } = await client.put(`/cards/${cardId}`, null, { params });
  return data;
}

// OpenRouter LLM
async function generateDescription({
  apiKey,
  model,
  title,
  currentDesc,
  listName,
}) {
  const system =
    "You write clear, concise Trello card descriptions for software tasks. Keep it factual, actionable, and concise (120-220 words). Use markdown with short sections and bullet points when helpful.";
  const user = `Title: ${title}\nList: ${
    listName || "Unknown"
  }\nExisting description (may be empty):\n${
    currentDesc || "(none)"
  }\n\nRewrite or generate a better description. Include:\n- Purpose / context\n- Scope / acceptance criteria\n- Implementation hints (brief)\n- Risks / dependencies\nAvoid fluff. No backticks in the output.`;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 450,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenRouter error: ${resp.status} ${txt}`);
  }
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("No content from OpenRouter");
  return text;
}

async function generateTitle({ apiKey, model, title, currentDesc }) {
  const system =
    "You improve Trello card titles: keep them brief (max ~12 words), specific, action-oriented, and without punctuation noise. Return only the title.";
  const user = `Current title: ${title}\nDescription:\n${
    currentDesc || "(none)"
  }\n\nReturn an improved, concise title.`;
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 60,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenRouter error: ${resp.status} ${txt}`);
  }
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("No title from OpenRouter");
  return text.replace(/^["'\s]+|["'\s]+$/g, "");
}

function withinHours(dateStr, hours) {
  const t = new Date(dateStr).getTime();
  return t >= Date.now() - hours * 3600 * 1000;
}

function nowISO() {
  return new Date().toISOString();
}

// Trello IDs encode creation time in the first 8 hex chars (seconds since epoch)
function trelloIdToDate(id) {
  try {
    const secHex = String(id).slice(0, 8);
    const sec = parseInt(secHex, 16);
    if (!isFinite(sec)) return null;
    return new Date(sec * 1000);
  } catch {
    return null;
  }
}

function withinHoursDate(dateObj, hours) {
  if (!dateObj) return false;
  return dateObj.getTime() >= Date.now() - hours * 3600 * 1000;
}

async function main() {
  const args = parseArgs(process.argv);
  const { TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID, OPENROUTER_API_KEY } = process.env;
  try { ensureConfig(); } catch (e) { console.error(e.message); process.exit(2); }
  if (!TRELLO_BOARD_ID) { console.error('Missing TRELLO_BOARD_ID in environment'); process.exit(2); }
  if (!OPENROUTER_API_KEY) {
    console.error("Missing OPENROUTER_API_KEY in environment");
    process.exit(2);
  }

  const me = await getMe();
  const [cards, lists] = await Promise.all([
    getBoardCards(TRELLO_BOARD_ID, ['id','name','desc','shortUrl','dateLastActivity','idMembers','idList']),
    getBoardLists(TRELLO_BOARD_ID, { includeClosed: false }),
  ]);
  const listMap = new Map(lists.map((l) => [l.id, l.name]));

  const sinceISO = new Date(
    Date.now() - args.hours * 3600 * 1000
  ).toISOString();
  const actions = await fetchBoardCreateActionsViaClient(TRELLO_BOARD_ID, sinceISO);
  const myCreatedCardIds = new Set(
    actions
      .filter(
        (a) =>
          a?.type === "createCard" &&
          a?.memberCreator?.id === me.id &&
          a?.data?.card?.id
      )
      .map((a) => a.data.card.id)
  );

  // Fallback: if no createCard actions found (or Trello API filtering misses), infer by membership + Trello ID timestamp
  let usedFallback = false;
  if (myCreatedCardIds.size === 0) {
    usedFallback = true;
    for (const c of cards) {
      const createdAt = trelloIdToDate(c.id);
      if (
        c.idMembers &&
        c.idMembers.includes(me.id) &&
        withinHoursDate(createdAt, args.hours)
      ) {
        myCreatedCardIds.add(c.id);
      }
    }
  }

  // Prepare candidates
  const cache = loadCache();
  const candidates = cards
    .filter((c) => myCreatedCardIds.has(c.id))
    .slice(0, args.maxCards);

  if (args.listOnly) {
    const header =
      `Found ${candidates.length} candidate cards created by you in the last ${args.hours}h` +
      (usedFallback ? " (fallback by membership+ID time)" : "");
    console.log(header);
    if (candidates.length) console.log("");
    candidates.forEach((c, idx) => {
      const listName = listMap.get(c.idList) || "Unknown";
      const descLen = String(c.desc || "").length;
      const short = descLen < args.minDescChars ? "short" : "ok";
      const createdAt = trelloIdToDate(c.id);
      const createdISO = createdAt ? createdAt.toISOString() : "unknown";
      console.log(`#${idx + 1} ${c.name}`);
      console.log(`   List: ${listName}`);
      console.log(`   Created: ${createdISO}`);
      console.log(`   Description: ${descLen} chars (${short})`);
      console.log(`   URL: ${c.shortUrl}`);
      if (idx !== candidates.length - 1) console.log("");
    });
    return;
  }

  let processedCount = 0;
  for (const card of candidates) {
    const entry = cache[card.id];
    const desc = String(card.desc || "");
    const descHash = sha1(desc);
    const listName = listMap.get(card.idList) || "Unknown";

    console.log(`Processing ${card.name}`);
    if (
      !args.force &&
      entry &&
      entry.descHash === descHash &&
      (entry.status === "applied" || entry.status === "skipped")
    ) {
      // Already handled with the same description; skip to save cost
      console.log(`Skipping ${card.name} (cached)`);
      continue;
    }

    if (desc.length >= args.minDescChars) {
      cache[card.id] = { status: "sufficient", descHash, updatedAt: nowISO() };
      continue;
    }

    console.log("\n=== Card ===");
    console.log(`Title: ${card.name}`);
    console.log(`List: ${listName}`);
    console.log(`Link: ${card.shortUrl}`);
    console.log(
      `Current description (${desc.length} chars):\n${desc || "(none)"}`
    );

    const proceed = await promptYesNo("Generate an enhanced description?");
    if (!proceed) {
      cache[card.id] = { status: "skipped", descHash, updatedAt: nowISO() };
      continue;
    }

    let suggestion = "";
    try {
      suggestion = await generateDescription({
        apiKey: OPENROUTER_API_KEY,
        model: args.model,
        title: card.name,
        currentDesc: desc,
        listName,
      });
    } catch (e) {
      console.error(`OpenRouter generation failed: ${e.message || e}`);
      cache[card.id] = {
        status: "error",
        error: String(e.message || e),
        descHash,
        updatedAt: nowISO(),
      };
      continue;
    }

    console.log("\n--- Suggested Description ---\n");
    console.log(suggestion);
    console.log("\n-----------------------------\n");

    let newTitle = card.name;
    if (args.title) {
      const askTitle = await promptYesNo("Also suggest a better title?");
      if (askTitle) {
        try {
          newTitle = await generateTitle({
            apiKey: OPENROUTER_API_KEY,
            model: args.model,
            title: card.name,
            currentDesc: suggestion || desc,
          });
          console.log(`\nSuggested Title: ${newTitle}`);
        } catch (e) {
          console.error(`Title generation failed: ${e.message || e}`);
          newTitle = card.name;
        }
      }
    }

    const apply = await promptYesNo(
      args.apply
        ? "Apply these changes to Trello now?"
        : "Apply (dry-run by default; will NOT update unless --apply was passed)?"
    );
    if (!apply) {
      cache[card.id] = { status: "skipped", descHash, updatedAt: nowISO() };
      continue;
    }

    const delimStart = "\n\n---\nAI Description (proposed)\n\n";
    const delimEnd = "\n";
    const existing = String(desc || "");
    let finalDesc = suggestion;
    if (args.merge === "prepend") {
      if (!existing.includes("AI Description (proposed)")) {
        finalDesc = `${suggestion}${delimStart}${existing}`.trim();
      } else {
        finalDesc = existing; // already merged previously
      }
    } else if (args.merge === "append") {
      if (!existing.includes("AI Description (proposed)")) {
        finalDesc = `${existing}${delimStart}${suggestion}${delimEnd}`.trim();
      } else {
        finalDesc = existing;
      }
    } else if (args.merge === "replace") {
      finalDesc = suggestion;
    }

    if (!args.apply) {
      console.log(
        "[dry-run] Would update Trello with new description" +
          (newTitle !== card.name ? " and title." : ".")
      );
      cache[card.id] = { status: "dry-run", descHash, updatedAt: nowISO() };
    } else {
      try {
        const updated = await updateCardViaClient(card.id, {
          name: newTitle === card.name ? undefined : newTitle,
          desc: finalDesc,
        });
        console.log(`Updated card: ${updated.shortUrl}`);
        cache[card.id] = {
          status: "applied",
          descHash: sha1(String(updated.desc || "")),
          updatedAt: nowISO(),
        };
        processedCount++;
      } catch (e) {
        console.error(`Trello update failed: ${e.message || e}`);
        cache[card.id] = {
          status: "error",
          error: String(e.message || e),
          descHash,
          updatedAt: nowISO(),
        };
      }
    }

    // Brief delay to be polite to APIs
    await new Promise((r) => setTimeout(r, 250));
  }

  saveCache(cache);

  console.log("\nDone.");
  console.log(
    `Considered ${candidates.length} cards. Applied updates: ${processedCount}.`
  );
}

main().catch((e) => {
  console.error("Fatal:", e.message || e);
  process.exit(1);
});
