# Trello 30-Hour Activity Report & Mattermost Integration

This project generates a comprehensive report of Trello cards you've interacted with in the last 30 hours, and lets you send your report to Mattermost.

---

## Features

- Filter and track Trello cards based on your manual Planyway export (paste JSON at the top of `daily-report.js`).
- Summed tracked time for each unique ticket (Planyway-style, even with duplicates).
- Output Markdown report, sorted and matched as in Planyway.
- Optional: Send the generated report to a Mattermost channel via webhook (`daily-report-to-mattermost.js`).

---

## Setup Instructions

### 1. Get Trello API Credentials

1. Go to https://trello.com/app-key
2. Copy your API Key
3. Click the "Token" link to generate a read token
4. Copy your token

### 2. Get Board ID

1. Open your Trello board
2. Look at the URL: `https://trello.com/b/BOARD_ID/board-name`
3. Copy the BOARD_ID part

### 3. Configure Environment

1. Copy `.env.example` to `.env`
2. Fill in your credentials:
   ```
   TRELLO_API_KEY=your_api_key_here
   TRELLO_TOKEN=your_token_here
   TRELLO_BOARD_ID=your_board_id_here
   ```

### 4. Install Dependencies

```bash
npm install
```

## Usage

### 1. Generate a Report with Planyway Data

1. Export or copy your Planyway tickets as JSON (see example format below).
2. Paste your JSON array into the `planywayTickets` variable at the top of `daily-report.js`.
3. Run the script:

```bash
node daily-report.js
```

- The script will fetch Trello cards, match and sum tracked time for each unique ticket (by name), and output a Markdown report in the same order as your Planyway data.
- The report file will be saved as `trello-summary-YYYY-MM-DD-HH.md`.

#### Example Planyway JSON

```js
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
  // ... more tickets
];
```

### 2. Send the Report to Mattermost

You can send your generated report to a Mattermost channel using the provided script `daily-report-to-mattermost.js`:

```bash
node daily-report-to-mattermost.js
```

- This script reads the Markdown report and posts it to a Mattermost webhook.
- Configure your webhook URL in your `.env` file:
  ```
  MATTERMOST_WEBHOOK_URL=https://your-mattermost-url/hooks/xxx
  ```

## What the Report Includes

- Only Trello cards whose names match your Planyway JSON (duplicates summed)
- Tracked time for each ticket (summed from Planyway)
- Output in Markdown, sorted as in your Planyway export
- Total tracked time for all tickets

## Output

- Markdown report: `trello-summary-YYYY-MM-DD-HH.md`
- Console progress and summary
- Optionally: posted to Mattermost if you run `daily-report-to-mattermost.js`

## Troubleshooting

### Common Issues

1. **Authentication Error**: Check your API key and token
2. **Board Not Found**: Verify your board ID
3. **Permission Error**: Ensure your token has read access to the board
4. **No tickets matched**: Make sure your Planyway ticket names match Trello card names exactly.
5. **Mattermost not posting**: Check your webhook URL and network connection.

### Getting Help

- Trello API Documentation: https://developer.atlassian.com/cloud/trello/rest/api-introduction/
- Check your API key: https://trello.com/app-key
