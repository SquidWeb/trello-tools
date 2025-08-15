require("dotenv").config();
const axios = require("axios");
const dayjs = require("dayjs");
const { getMe, getBoardCards: trelloGetBoardCards, getListNameById } = require('./lib/trello');

const { TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID } = process.env;

// Get current user info
async function getCurrentUser() {
  return getMe();
}

// Get all cards from the board with basic info
async function getBoardCards() {
  return trelloGetBoardCards(
    TRELLO_BOARD_ID,
    ["id","name","shortUrl","dateLastActivity","idMembers","idList"],
    { members: true, member_fields: "id,fullName,username" }
  );
}

// Get card actions separately to avoid timeout issues
async function getCardActions(cardId) {
  console.log("Params:", { ...params, token: "***" }); // Hide token in logs

  try {
    const res = await axios.get(url, { params });
    // Filter cards where the current member is assigned
    const allCards = res.data.filter(
      (card) => card.idMembers && card.idMembers.includes(memberId)
    );

    const cardsWithPlanywayTime = [];

    // First, let's log the plugin data structure to find the correct plugin ID
    if (allCards.length > 0) {
      console.log("\nFound", allCards.length, "cards assigned to you");
      console.log(
        "First card plugin data:",
        JSON.stringify(allCards[0].pluginData, null, 2)
      );
    } else {
      console.log("No cards found assigned to you");
    }

    // Process each card to find time tracking data
    for (const card of allCards) {
      // Skip cards that don't have the current user as a member
      if (!card.idMembers?.includes(memberId)) {
        continue;
      }

      // Log the card details for debugging
      console.log(`\nProcessing card: ${card.name} (${card.shortUrl})`);

      // Check if the card has plugin data
      if (card.pluginData && card.pluginData.length > 0) {
        console.log(
          "Plugin data found:",
          JSON.stringify(card.pluginData, null, 2)
        );
      }

      // Check if the card has custom field items
      if (card.customFieldItems && card.customFieldItems.length > 0) {
        const timeEntries = [];
        let totalMinutes = 0;

        // Log the card details for debugging
        console.log(`\nProcessing card: ${card.name} (${card.shortUrl})`);

        // Check each custom field item
        for (const item of card.customFieldItems) {
          const field = customFields.find((f) => f.id === item.idCustomField);
          if (!field) continue;

          // Try to extract time data based on field type
          if (item.value) {
            if (
              field.type === "number" &&
              (field.name.toLowerCase().includes("time") ||
                field.name.toLowerCase().includes("hours") ||
                field.name.toLowerCase().includes("logged"))
            ) {
              const minutes = Math.round(
                parseFloat(item.value.number || 0) * 60
              );
              if (minutes > 0) {
                console.log(
                  `- Found time entry in '${field.name}': ${item.value.number} hours (${minutes} minutes)`
                );
                timeEntries.push({
                  description: field.name,
                  timeSpent: minutes,
                  date: card.dateLastActivity,
                  source: "custom_field",
                });
                totalMinutes += minutes;
              }
            } else if (field.type === "text" && item.value.text) {
              // Try to parse time from text fields
              const timeMatch = item.value.text.match(
                /(\d+(\.\d+)?)\s*(h|hr|hour|hours)/i
              );
              if (timeMatch) {
                const hours = parseFloat(timeMatch[1]);
                const minutes = Math.round(hours * 60);
                console.log(
                  `- Found time entry in '${field.name}': ${hours} hours (${minutes} minutes)`
                );
                timeEntries.push({
                  description: field.name,
                  timeSpent: minutes,
                  date: card.dateLastActivity,
                  source: "text_field",
                });
                totalMinutes += minutes;
              }
            }
          }
        }

        // If we found time entries, add the card to the results
        if (timeEntries.length > 0) {
          cardsWithPlanywayTime.push({
            cardId: card.id,
            cardName: card.name,
            cardUrl: card.shortUrl,
            timeEntries: timeEntries,
            totalTime: totalMinutes,
            formattedTime: `${Math.floor(totalMinutes / 60)}h ${
              totalMinutes % 60
            }m`,
          });
        }
      }
    }

    return cardsWithPlanywayTime;
  } catch (error) {
    console.error("Error fetching Trello cards:", error);
    return null;
  }
}

function cardUpdatedToday(card) {
  const lastActivity = dayjs(card.dateLastActivity);
  return lastActivity.isSame(today, "day");
}

function formatCardMessage(card) {
  return `• ${card.name}\n${card.shortUrl}`;
}

async function postToMattermost(text) {
  // await axios.post(MATTERMOST_WEBHOOK, { text });
}

function formatTimeTrackingReport(cards) {
  if (cards.length === 0) {
    return "No time entries found for today.";
  }

  let report = `Time Tracking Report for ${today}\n\n`;

  cards.forEach((card, index) => {
    report += `${index + 1}. ${card.cardName}\n`;
    report += `   🔗 ${card.cardUrl}\n`;
    report += `   ⏱️  Total time: ${card.formattedTime}\n\n`;

    card.timeEntries.forEach((entry, i) => {
      const startTime = dayjs(entry.started).format("HH:mm");
      const duration = entry.timeSpent || 0;
      const durationStr = `${Math.floor(duration / 60)}h ${duration % 60}m`;

      report += `   • ${startTime} - ${
        entry.description || "No description"
      }: ${durationStr}\n`;
    });

    report += "\n";
  });

  return report;
}

// Check if user interacted with card within last 30 hours
function hasRecentInteraction(card, userId, cutoffTime, actions = []) {
  const interactions = [];

  // Check card creation/updates
  const lastActivity = dayjs(card.dateLastActivity);
  if (lastActivity.isAfter(cutoffTime)) {
    interactions.push({
      type: "card_activity",
      time: lastActivity.format("YYYY-MM-DD HH:mm"),
      description: "Card activity detected",
    });
  }

  // Check actions for user interactions
  if (actions && Array.isArray(actions)) {
    actions.forEach((action) => {
      if (action.idMemberCreator === userId) {
        const actionTime = dayjs(action.date);
        if (actionTime.isAfter(cutoffTime)) {
          let description = action.type;
          if (action.data && action.data.text) {
            description = `Comment: ${action.data.text.substring(
              0,
              50
            )}${action.data.text.length > 50 ? "..." : ""}`;
          } else if (action.data && action.data.listAfter) {
            description = `Moved card to ${action.data.listAfter.name}`;
          } else if (action.type === "createCard") {
            description = "Created this card";
          } else if (action.type === "addMemberToCard") {
            description = "Added member to card";
          } else if (action.type === "removeMemberFromCard") {
            description = "Removed member from card";
          }

          interactions.push({
            type: action.type,
            time: actionTime.format("YYYY-MM-DD HH:mm"),
            description: description,
          });
        }
      }
    });
  }

  // Check if user is assigned to card
  if (card.idMembers && card.idMembers.includes(userId)) {
    interactions.push({
      type: "assigned",
      time: "current",
      description: "Currently assigned to this card",
    });
  }

  return interactions;
}

// Get list name by ID
async function getListName(listId) {
  try {
    return await getListNameById(TRELLO_BOARD_ID, listId);
  } catch (error) {
    return "Unknown List";
  }
}

// Format the report
function formatReport(cardsWithActivity, userName) {
  const thirtyHoursAgo = dayjs().subtract(30, "hours");
  const cutoffTime = thirtyHoursAgo.format("YYYY-MM-DD HH:mm");

  let report = `TRELLO ACTIVITY REPORT - LAST 30 HOURS\n`;
  report += `="=".repeat(60)}\n\n`;
  report += `User: ${userName}\n`;
  report += `Since: ${cutoffTime}\n`;
  report += `Generated: ${dayjs().format("YYYY-MM-DD HH:mm:ss")}\n\n`;

  if (cardsWithActivity.length === 0) {
    report += "No interactions found in the last 30 hours.\n";
    report += "\nThis could mean:\n";
    report += "• No recent activity on the board\n";
    report += "• Activity is older than 30 hours\n";
    report += "• Check your Trello API credentials\n";
    return report;
  }

  report += `Found ${cardsWithActivity.length} cards with recent activity:\n\n`;

  cardsWithActivity.forEach((item, index) => {
    report += `${index + 1}. ${item.card.name}\n`;
    report += `   🔗 ${item.card.shortUrl}\n`;
    report += `   📋 List: ${item.listName}\n`;
    report += `   🕐 Last Activity: ${dayjs(item.card.dateLastActivity).format(
      "YYYY-MM-DD HH:mm"
    )}\n`;

    if (item.interactions.length > 0) {
      report += `   📝 Your Interactions:\n`;
      item.interactions.forEach((interaction) => {
        report += `      • ${interaction.time} - ${interaction.description}\n`;
      });
    }
    report += `\n${"-".repeat(60)}\n\n`;
  });

  return report;
}

// Main function to get cards with interactions
async function getCardsWithInteractions() {
  try {
    console.log("🎯 Trello 30-Hour Activity Report Generator");
    console.log("=".repeat(60));
    
    // Validate environment
    if (!TRELLO_API_KEY || !TRELLO_TOKEN || !TRELLO_BOARD_ID) {
      throw new Error("Missing required Trello credentials. Please check your .env file.");
    }
    
    console.log("✅ Environment variables validated");
    
    // Get current user
    console.log("Fetching user information...");
    const currentUser = await getCurrentUser();
    console.log(`✅ Found user: ${currentUser.fullName || currentUser.username}`);
    
    // Get all cards from board with actions in one call
    console.log("Fetching board cards...");
    const cards = await getBoardCards();
    console.log(`✅ Found ${cards.length} cards on the board`);
    
    // Calculate cutoff time (30 hours ago)
    const thirtyHoursAgo = dayjs().subtract(30, "hours");
    console.log(`📅 Looking for interactions since: ${thirtyHoursAgo.format("YYYY-MM-DD HH:mm")}`);
    
    // Process cards to find interactions
    const cardsWithActivity = [];
    
    console.log("🔍 Analyzing card interactions...");
    
    // Cache list names to avoid repeated API calls
    const listNameCache = new Map();
    
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      
      // Show progress every 10 cards
      if (i % 10 === 0) {
        process.stdout.write(`Processing ${i + 1}/${cards.length} cards...\r`);
      }
      
      // Get list name from cache or API
      let listName = listNameCache.get(card.idList);
      if (!listName) {
        listName = await getListName(card.idList);
        listNameCache.set(card.idList, listName);
      }
      
      // Check for interactions with basic info
      const interactions = hasRecentInteraction(card, currentUser.id, thirtyHoursAgo);
      
      // If we have basic interactions, get detailed actions
      let detailedActions = [];
      if (interactions.length > 0) {
        detailedActions = await getCardActions(card.id);
        // Re-check with detailed actions
        const detailedInteractions = hasRecentInteraction(card, currentUser.id, thirtyHoursAgo, detailedActions);
        
        if (detailedInteractions.length > 0) {
          cardsWithActivity.push({
            card,
            interactions: detailedInteractions,
            listName
          });
        }
      }
    }
    
    console.log(`\n✅ Found ${cardsWithActivity.length} cards with recent interactions`);
    
    // Sort by most recent activity
    cardsWithActivity.sort((a, b) => {
      return new Date(b.card.dateLastActivity) - new Date(a.card.dateLastActivity);
    });
    
    // Generate and display report
    const report = formatReport(cardsWithActivity, currentUser.fullName || currentUser.username);
    console.log("\n" + "=".repeat(60));
    console.log(report);
    
    // Save report to file
    try {
      const fs = require('fs');
      const reportFileName = `trello-activity-report-${dayjs().format('YYYY-MM-DD-HH-mm')}.txt`;
      fs.writeFileSync(reportFileName, report);
      console.log(`📄 Report saved to: ${reportFileName}`);
    } catch (error) {
      console.warn("⚠️ Could not save report to file:", error.message);
    }
    
    return cardsWithActivity;
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    throw error;
  }
}

// Simple test function
async function testConnection() {
  try {
    const user = await getCurrentUser();
    console.log("✅ Connection successful!");
    console.log(`User: ${user.fullName} (${user.username})`);
    console.log("Email:", user.email);
    return true;
  } catch (error) {
    console.error("❌ Connection failed:", error.message);
    return false;
  }
}

// Run the main function
async function main() {
  console.log("🎯 Trello 30-Hour Activity Report Generator");
  console.log("=".repeat(60));
  
  if (process.argv.includes('--test')) {
    await testConnection();
    return;
  }
  
  await getCardsWithInteractions();
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  getCardsWithInteractions,
  getCurrentUser,
  formatReport
};

// Example usage:
// Replace 'YOUR_CARD_ID' with an actual card ID from your board
// Uncomment and run the line below with a valid card ID
// getCardData("T3rqhCtL");

run();
