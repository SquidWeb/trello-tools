# Commands

Short list of available tools (run via `npm run <name>` where applicable):

- `daily-report` — Generate a report of Trello cards you've interacted with today, and let you send it to Mattermost.
- `daily-report-to-mattermost` — Send the generated report to a Mattermost channel via webhook.
- `pr-to-trello` — Convert a GitHub PR into a Trello comment; optionally move to review and complete.
- `due-today` — Move overdue "Doing" cards assigned to you to today (spaced times).
- `create-card` — Create a new Trello card with title, description (text or @file), assign you, due today.
- `trello-branch` — Generate a branch-friendly slug from a Trello card URL (e.g., `9614-some-title`).
- `review-week` — Review recent-due cards and mark complete (optionally move to Done).
- `trello-export` — Export a Trello card to a local folder with markdown and screenshots.
- `planyway-inspect` — Inspect Planyway pluginData/custom fields for a card or board.
- `planyway-watch` — Watch a card and print diffs in pluginData/custom fields over time.
- `catalog` — List all available CLI tools in this repository.
- `trello-enhance` — Enhance card descriptions (and titles) with an LLM via OpenRouter.

# Trello Activity Report & Mattermost Integration

This project generates a comprehensive report of Trello cards you've interacted with today, and lets you send your report to Mattermost.

---

## Features

- Filter and track Trello cards based on your manual Planyway export (added to `today.json`).
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
2. Paste your JSON array into the `today.json` file.
3. Add the screenshot from Planyway to `today.png`.
4. Run the script:

```bash
node daily-report.js
```

- The script will fetch Trello cards, match and sum tracked time for each unique ticket (by name), and output a Markdown report in the same order as your Planyway data.
- The report file will be saved as `trello-summary-YYYY-MM-DD-HH.md`.

Tip: Populate `today.json` quickly from Planyway

- Open Planyway, Time Tracking, switch to list view, then open your browser DevTools Console, paste the contents of `planyway-list.js`, and press Enter.
- It prints a small table and copies today's rows to your clipboard (if `copy` is available).
- Paste into `today.json`, save, then run the daily report.

#### Example Planyway JSON

```js
[
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
]
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

## PR to Trello (short)

Turn a GitHub PR into a Trello comment with test steps and screenshots, then optionally move the card to review.

### Setup (extra)

Add these to `.env` in addition to Trello creds above:

```
GITHUB_TOKEN=ghp_xxx
# Optional for auto-moving to review
REVIEW_LIST_ID=xxxx            # or
TRELLO_BOARD_ID=xxxx
REVIEW_LIST_NAME=Ready for review & testing (developers)

# Optional: replace localhost links in PR description with staging
UR_STAGING_BASE_URL=https://your-staging.example.com
```

### Run

```
npm run pr-to-trello -- <PR_URL>
# or
npm run pr-to-trello -- <PR_ID> <owner/repo>
```

Useful flags:

- --yes skip preview confirmation
- --no-test omit the "How to test" block
- --inline embed images instead of posting links

### What it does

- Finds the Trello card URL in the PR description.
- Parses "How to test" (and similar) and screenshots; ignores "Notes for me".
- Replaces localhost URLs with staging if `UR_STAGING_BASE_URL` is set (special-case port 3002 to staging).
- Posts a single formatted comment to the card.
- Then asks: move card to "Ready for review & testing (developers)" and mark complete? If no, it does nothing else. It never moves cards to "Rejected".

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
