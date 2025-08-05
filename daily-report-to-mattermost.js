// Script to send each ticket line and summary from a markdown report to Mattermost
// Usage: node send_to_mattermost.js <markdown_file> <mattermost_channel_id>
require("dotenv").config();
const fs = require("fs");
const dayjs = require("dayjs");
const { postToChannel } = require("./mattermost");

const MATTERMOST_URL = process.env.MATTERMOST_URL;
const MATTERMOST_TOKEN = process.env.MATTERMOST_TOKEN;

if (!MATTERMOST_URL || !MATTERMOST_TOKEN) {
  console.error(
    "MATTERMOST_URL and MATTERMOST_TOKEN must be set as environment variables."
  );
  process.exit(1);
}
const filename = `daily-report-${dayjs().format("YYYY-MM-DD-HH")}.md`;
const channelId = "18wejrtaufghupg6hq9fg7cf3w";

function parseMarkdownSections(md) {
  const lines = md.split(/\r?\n/);
  let summaryLines = [];
  let ticketLines = [];
  let inTicketSection = false;
  for (const line of lines) {
    if (line.trim().startsWith("## tickets:")) {
      inTicketSection = true;
      continue;
    }
    if (line.startsWith("---")) break;
    if (inTicketSection) {
      if (line.trim()) ticketLines.push(line);
    } else {
      summaryLines.push(line);
    }
  }
  return {
    summary: summaryLines.join("\n").trim(),
    tickets: ticketLines.map((l) => l.trim()).filter(Boolean),
  };
}

(async () => {
  const md = fs.readFileSync(filename, "utf8");
  const { summary, tickets } = parseMarkdownSections(md);

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

  console.log("\n=== END DRY RUN ===\n");

  if (tickets.length === 0 && !summary) {
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
          if (summary) {
            await postToChannel(channelId, summary);
            console.log("✅ Summary sent");
          }

          for (const ticket of tickets) {
            await postToChannel(channelId, ticket);
            console.log(`✅ Ticket sent: ${ticket}`);
            // Optional: add delay to avoid rate limits
            await new Promise((res) => setTimeout(res, 500));
          }

          console.log("\n🎉 All messages sent successfully!");
        } catch (error) {
          console.error("❌ Error sending messages:", error.message);
        }
      } else {
        console.log("❌ Cancelled. No messages were sent.");
      }
      rl.close();
    }
  );
})();
