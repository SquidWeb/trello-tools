// Script to send each ticket line and summary from a markdown report to Mattermost
// Usage: node send_to_mattermost.js <markdown_file> <mattermost_channel_id>
require("dotenv").config();
const fs = require("fs");
const dayjs = require("dayjs");
const { postToChannel, uploadFile } = require("./mattermost");

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
            console.log("✅ Summary sent" + (screenshotFileId ? " with screenshot" : ""));
            screenshotFileId = null; // Only attach to first message
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
