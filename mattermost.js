// Standalone script to send a message to a Mattermost channel using the API token
// Usage:
//   MATTERMOST_URL=... MATTERMOST_TOKEN=... node send_mattermost_message.js <channel_id> <message>
require("dotenv").config();
const axios = require("axios");

const MATTERMOST_URL = process.env.MATTERMOST_URL;
const MATTERMOST_TOKEN = process.env.MATTERMOST_TOKEN;
const MAX_MESSAGE_CHARS = 16383;

if (!MATTERMOST_URL || !MATTERMOST_TOKEN) {
  console.error(
    "MATTERMOST_URL and MATTERMOST_TOKEN must be set as environment variables."
  );
  process.exit(1);
}

async function postToChannel(channel, text) {
  const messageClippedSuffixText = "... (message clipped)";
  const messageText =
    text && String(text).length > MAX_MESSAGE_CHARS
      ? `${String(text).substr(
          0,
          MAX_MESSAGE_CHARS - messageClippedSuffixText.length - 1
        )}${messageClippedSuffixText}`
      : text;
  const data = {
    channel_id: channel,
    message: messageText,
  };
  const config = {
    method: "POST",
    url: `${MATTERMOST_URL}api/v4/posts`,
    data,
    headers: {
      Authorization: `Bearer ${MATTERMOST_TOKEN}`,
    },
    timeout: 30000,
  };
  try {
    const res = await axios(config);
    console.log("Message sent:", res.data);
  } catch (e) {
    console.error(
      "Error sending message:",
      e.response ? e.response.data : e.message
    );
    process.exit(2);
  }
}

module.exports = { postToChannel };

