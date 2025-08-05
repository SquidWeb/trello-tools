require("dotenv").config();
const axios = require("axios");
const dayjs = require("dayjs");
const fs = require("fs");

const { TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID } = process.env;

// ==== PASTE YOUR PLANYWAY JSON HERE EACH TIME ====
const planywayTickets = [
  {
    date: "Aug 05",
    name: "mobile endpoints | broken access control",
    time: "0‎h 48m",
  },
  {
    date: "Aug 05",
    name: "mobile endpoints | broken access control",
    time: "1‎h 22m",
  },
  {
    date: "Aug 05",
    name: "mobile endpoints | broken access control",
    time: "5‎h 43m",
  },
];
// ================================================

// Configuration
const DONE_LIST_NAMES = [/done/, /review/];

// Add your blacklist patterns here (case insensitive)
const BLACKLIST_PATTERNS = ["sprint"];

function isBlacklisted(cardName) {
  if (!cardName) return false;
  const lowerName = cardName.toLowerCase();
  return BLACKLIST_PATTERNS.some((pattern) =>
    lowerName.includes(pattern.toLowerCase())
  );
}

// Helper to parse "Xh Ym" format (with possible invisible chars)
function parseTime(str) {
  const clean = str.replace(/[^\dh\dm]/g, "");
  const h = /([0-9]+)h/.exec(clean);
  const m = /([0-9]+)m/.exec(clean);
  return (h ? parseInt(h[1]) : 0) * 60 + (m ? parseInt(m[1]) : 0);
}

async function generateQuickReport() {
  console.log("🎯 Trello 30-Hour Activity Report - Quick Demo");
  console.log("=".repeat(60));

  try {
    // === 1. Fetch Trello user ===
    console.log("Fetching user information...");
    const userUrl = `https://api.trello.com/1/members/me?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`;
    const userResponse = await axios.get(userUrl);
    const currentUser = userResponse.data;
    console.log(` User: ${currentUser.fullName || currentUser.username}`);

    // === 2. Load or fetch Trello board data ===
    const baseFilename = `trello-summary-${dayjs().format("YYYY-MM-DD-HH")}`;
    const cacheFile = baseFilename + ".json";
    let lists, cards;
    const exists = fs.existsSync(cacheFile);
    if (exists) {
      console.log(`Using cached Trello data: ${cacheFile}`);
      const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      lists = cache.lists;
      cards = cache.cards;
    } else {
      // Fetch lists
      console.log("Fetching board lists...");
      const listsUrl = `https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/lists`;
      const listsResponse = await axios.get(listsUrl, {
        params: {
          key: TRELLO_API_KEY,
          token: TRELLO_TOKEN,
          fields: "id,name,closed",
        },
      });
      lists = listsResponse.data.filter((list) => !list.closed);
      // Map of list IDs to names
      const listMap = new Map(lists.map((list) => [list.id, list.name]));
      // Fetch cards
      console.log("Fetching cards...");
      const cardsUrl = `https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/cards`;
      const cardsResponse = await axios.get(cardsUrl, {
        params: {
          key: TRELLO_API_KEY,
          token: TRELLO_TOKEN,
          fields: "id,name,shortUrl,dateLastActivity,idMembers,idList",
          members: true,
        },
      });
      // Add list name and status to each card
      cards = cardsResponse.data.map((card) => {
        const listName = listMap.get(card.idList) || "Unknown";
        const lowerListName = listName.toLowerCase();
        return {
          ...card,
          listName,
          isDone: DONE_LIST_NAMES.some((regex) => regex.test(lowerListName)),
        };
      });
      // Cache
      fs.writeFileSync(cacheFile, JSON.stringify({ lists, cards }, null, 2));
      console.log(`Cached Trello data to: ${cacheFile}`);
    }
    console.log(` Found ${cards.length} total cards`);

    // === 3. Filter cards to recent, non-blacklisted, assigned to user ===
    const thirtyHoursAgo = dayjs().subtract(30, "hours");
    const recentCards = cards.filter((card) => {
      const lastActivity = dayjs(card.dateLastActivity);
      return lastActivity.isAfter(thirtyHoursAgo) && !isBlacklisted(card.name);
    });
    const myCards = recentCards.filter(
      (card) => card.idMembers && card.idMembers.includes(currentUser.id)
    );
    console.log(`Found ${myCards.length} cards in the last 30 hours`);

    // === 4. Group Planyway tickets by name and sum their time ===
    function groupPlanywayTickets(tickets) {
      const groups = [];
      const seen = new Set();
      for (const t of tickets) {
        if (!seen.has(t.name)) {
          seen.add(t.name);
          groups.push({ name: t.name, totalMinutes: 0 });
        }
      }
      for (const group of groups) {
        group.totalMinutes = tickets
          .filter((t) => t.name === group.name)
          .reduce((sum, t) => sum + parseTime(t.time), 0);
      }
      return groups;
    }
    const planywayGrouped = groupPlanywayTickets(planywayTickets);

    // === 5. Match grouped Planyway tickets to Trello cards ===
    const trelloMatches = planywayGrouped
      .map((group) => {
        const card = myCards.find((c) => c.name === group.name);
        return card
          ? { name: group.name, card, trackedMinutes: group.totalMinutes }
          : null;
      })
      .filter(Boolean);

    // === 6. Sum total tracked time for all tickets ===
    const totalMinutes = planywayGrouped.reduce(
      (sum, g) => sum + g.totalMinutes,
      0
    );
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    const trackedTime = `${totalHours}h ${remainingMinutes}m`;

    // === 7. Log blacklisted cards for reference ===
    const blacklistedCards = cards.filter((card) => isBlacklisted(card.name));
    if (blacklistedCards.length > 0) {
      console.log(
        `\n⚠️  Blacklisted ${blacklistedCards.length} cards based on name patterns`
      );
    }

    // === 8. Format and save the report ===
    const summaryBlock = `\n${
      currentUser.fullName || currentUser.username
    }: update 8h | tracked ${trackedTime}\n`;
    const ticketListBlock = trelloMatches
      .map(({ card, trackedMinutes }) => {
        const hours = Math.floor(trackedMinutes / 60);
        const minutes = trackedMinutes % 60;
        const tracked = `${hours}h ${minutes}m`;
        return `- [${card.name}](${card.shortUrl}) - ${card.listName} | ${tracked}`;
      })
      .join("\n");
    const report = `${summaryBlock}\n## tickets:\n${ticketListBlock}\n\n---\n_Report generated by Trello Activity Tracker with Planyway time reference_`;

    const filename = `daily-report-${dayjs().format("YYYY-MM-DD-HH")}.md`;
    fs.writeFileSync(filename, report);
    console.log(`\n📄 Report saved: ${filename}`);
    console.log("\n✅ Complete! Check the generated file for full details.");
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
    }
  }
}

generateQuickReport();
