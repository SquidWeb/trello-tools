// Script to send each ticket line and summary from a markdown report to Mattermost
// Usage: node send_to_mattermost.js <markdown_file> <mattermost_channel_id>
require("dotenv").config();
const fs = require("fs");
const dayjs = require("dayjs");
const { postToChannel, uploadFile } = require("./lib/mattermost");
const { 
  getMe, 
  getBoardLists, 
  getListByName, 
  getListCards, 
  updateCardDue 
} = require("./lib/trello");

const MATTERMOST_URL = process.env.MATTERMOST_URL;
const MATTERMOST_TOKEN = process.env.MATTERMOST_TOKEN;
const { TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID, TRELLO_DOING_LIST_ID, DOING_LIST_NAME } = process.env;

if (!MATTERMOST_URL || !MATTERMOST_TOKEN) {
  console.error(
    "MATTERMOST_URL and MATTERMOST_TOKEN must be set as environment variables.",
  );
  process.exit(1);
}

if (!TRELLO_API_KEY || !TRELLO_TOKEN) {
  console.error(
    "TRELLO_API_KEY and TRELLO_TOKEN must be set as environment variables to move tickets.",
  );
  process.exit(1);
}
const filename = `./reports/daily-report-${dayjs().format("YYYY-MM-DD-HH")}.md`;
const channelId = "18wejrtaufghupg6hq9fg7cf3w";

function parseMarkdownSections(md) {
  const lines = md.split(/\r?\n/);
  let summaryLines = [];
  let ticketLines = [];
  let screenshotPath = null;
  let inTicketSection = false;
  let inScreenshotSection = false;

  for (const line of lines) {
    if (line.trim().startsWith("## tickets:")) {
      inTicketSection = true;
      inScreenshotSection = false;
      continue;
    }
    if (line.trim().startsWith("## screenshot:")) {
      inScreenshotSection = true;
      inTicketSection = false;
      continue;
    }
    if (line.startsWith("---")) break;

    if (inScreenshotSection) {
      // Extract screenshot path from markdown image syntax
      const imageMatch = line.match(/!\[.*?\]\((.+?)\)/);
      if (imageMatch) {
        screenshotPath = imageMatch[1];
      }
    } else if (inTicketSection) {
      if (line.trim()) ticketLines.push(line);
    } else {
      summaryLines.push(line);
    }
  }
  return {
    summary: summaryLines.join("\n").trim(),
    tickets: ticketLines.map((l) => l.trim()).filter(Boolean),
    screenshotPath: screenshotPath,
  };
}

(async () => {
  const md = fs.readFileSync(filename, "utf8");
  const { summary, tickets, screenshotPath } = parseMarkdownSections(md);

  console.log("=== DRY RUN: Messages to be sent to Mattermost ===\n");

  if (summary) {
    console.log("📊 SUMMARY:");
    console.log(summary);
    console.log("");
  }

  console.log("🎫 TICKETS:");
  tickets.forEach((ticket) => {
    console.log("sending ticket: ", ticket);
  });

  if (screenshotPath) {
    console.log("\n📸 SCREENSHOT:");
    console.log(`Screenshot file: ${screenshotPath}`);
    if (fs.existsSync(screenshotPath)) {
      console.log("✅ Screenshot file found");
    } else {
      console.log("❌ Screenshot file not found");
    }
  }

  console.log("\n=== END DRY RUN ===\n");

  if (tickets.length === 0 && !summary && !screenshotPath) {
    console.log("❌ No content to send. Exiting.");
    return;
  }

  // Ask for user confirmation
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    "Do you want to send these messages to Mattermost? (y/N): ",
    async (answer) => {
      if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
        console.log("\n🚀 Sending messages to Mattermost...");

        try {
          let screenshotFileId = null;

          // Upload screenshot first if it exists
          if (screenshotPath && fs.existsSync(screenshotPath)) {
            console.log("📸 Uploading screenshot...");
            const fileInfo = await uploadFile(channelId, screenshotPath);
            screenshotFileId = fileInfo.id;
            console.log("✅ Screenshot uploaded");
          }

          if (summary) {
            const fileIds = screenshotFileId ? [screenshotFileId] : [];
            await postToChannel(channelId, summary, fileIds);
            console.log(
              "✅ Summary sent" + (screenshotFileId ? " with screenshot" : ""),
            );
            screenshotFileId = null; // Only attach to first message
          }

          for (const ticket of tickets) {
            await postToChannel(channelId, ticket);
            console.log(`✅ Ticket sent: ${ticket}`);
            // Optional: add delay to avoid rate limits
            await new Promise((res) => setTimeout(res, 500));
          }

          console.log("\n🎉 All messages sent successfully!");
          
          // Move tickets to next due date after successful send
          await moveDoingTicketsToNextDueDate();
          
        } catch (error) {
          console.error("❌ Error sending messages:", error.message);
        }
      } else {
        console.log("❌ Cancelled. No messages were sent.");
      }
      rl.close();
    },
  );
async function getDoingListId() {
  if (TRELLO_DOING_LIST_ID) return TRELLO_DOING_LIST_ID;
  if (!TRELLO_BOARD_ID) throw new Error('Missing TRELLO_BOARD_ID or TRELLO_DOING_LIST_ID in .env');
  const list = await getListByName(TRELLO_BOARD_ID, DOING_LIST_NAME || 'Doing');
  if (!list) throw new Error(`Cannot find list named "${DOING_LIST_NAME || 'Doing'}" on board ${TRELLO_BOARD_ID}`);
  return list.id;
}

function getNextDueDate() {
  const now = dayjs();
  const hour = now.hour();
  
  // If before noon (12:00), set due date to today
  // If after noon, set due date to tomorrow
  if (hour < 12) {
    return now.hour(9).minute(0).second(0).millisecond(0); // Today at 9:00 AM
  } else {
    return now.add(1, 'day').hour(9).minute(0).second(0).millisecond(0); // Tomorrow at 9:00 AM
  }
}

async function moveDoingTicketsToNextDueDate() {
  try {
    console.log('\n🔄 Moving tickets from Doing list to next due date...');
    
    const now = dayjs();
    const nextDueDate = getNextDueDate();
    const targetDueIso = nextDueDate.toISOString();
    
    console.log(`📅 Target due date: ${nextDueDate.format('YYYY-MM-DD HH:mm')}`);
    
    // Get current user
    const me = await getMe();
    const myId = me.id;
    
    // Get Doing list
    const listId = await getDoingListId();
    
    // Get cards in Doing list
    const cards = await getListCards(listId, ['name','due','idMembers','url']);
    
    // Filter cards assigned to current user
    const myCards = cards.filter((c) => Array.isArray(c.idMembers) && c.idMembers.includes(myId));
    
    if (myCards.length === 0) {
      console.log('✅ No assigned cards found in Doing list.');
      return;
    }
    
    console.log(`📝 Found ${myCards.length} assigned cards in Doing list:`);
    myCards.forEach((c) => console.log(`- ${c.name} (${c.url}) | current due: ${c.due || 'not set'}`));
    
    // Show preview of changes and ask for confirmation
    console.log('\n📋 PREVIEW: Tickets that will be moved to new due dates:');
    let previewSlot = nextDueDate;
    const incrementMinutes = 120; // space items 2 hours apart
    
    for (const card of myCards) {
      console.log(`- ${card.name} -> ${previewSlot.format('YYYY-MM-DD HH:mm')}`);
      previewSlot = previewSlot.add(incrementMinutes, 'minute');
    }
    
    // Ask for user confirmation
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    const shouldProceed = await new Promise((resolve) => {
      rl.question(
        '\nDo you want to proceed with moving these tickets to the new due dates? (y/N): ',
        (answer) => {
          rl.close();
          resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        }
      );
    });
    
    if (!shouldProceed) {
      console.log('❌ Cancelled. No tickets were moved.');
      return;
    }
    
    console.log('\n🚀 Moving tickets to new due dates...');
    
    // Update due dates with sequential time slots
    let slot = nextDueDate;
    
    for (const card of myCards) {
      const cardTargetDue = slot.toISOString();
      await updateCardDue(card.id, cardTargetDue);
      console.log(`✅ Updated due for: ${card.name} -> ${slot.format('YYYY-MM-DD HH:mm')}`);
      slot = slot.add(incrementMinutes, 'minute');
    }
    
    console.log('🎉 All tickets moved to next due date successfully!');
  } catch (error) {
    console.error('❌ Error moving tickets to next due date:', error.message);
  }
}

})();
