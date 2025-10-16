#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');
const {
  ensureConfig,
  getMe,
  getBoardLists,
  getCardsInLists,
  getCardComments,
} = require('./lib/trello');

const {
  TRELLO_BOARD_ID,
  GITHUB_TOKEN,
} = process.env;

const DEFAULT_REJECTED_LABEL = 'rejected';

function extractPrLinks(text) {
  if (!text) return [];
  const regex = /https?:\/\/github\.com\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/gi;
  const out = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    out.push({ owner: match[1], repo: match[2], number: parseInt(match[3], 10) });
  }
  return out;
}

async function getReviewerLogin(http) {
  const { data } = await http.get('/user');
  return data.login;
}

async function gatherRejectedCards(myId) {
  if (!TRELLO_BOARD_ID) {
    throw new Error('TRELLO_BOARD_ID is required');
  }
  ensureConfig();
  const lists = await getBoardLists(TRELLO_BOARD_ID, { includeClosed: false });
  const rejectedLists = lists.filter((list) => (list.name || '').toLowerCase().includes('rejected'));
  if (rejectedLists.length === 0) {
    return [];
  }
  const listIds = rejectedLists.map((list) => list.id);
  const cards = await getCardsInLists(listIds, ['id', 'name', 'shortUrl', 'idMembers', 'dateLastActivity']);
  // Filter to only cards assigned to current user
  return cards.filter((card) => Array.isArray(card.idMembers) && card.idMembers.includes(myId));
}

async function mapCardsToPrs(cards, http, githubLogin) {
  const results = new Map();
  for (const card of cards) {
    const comments = await getCardComments(card.id);
    const links = new Map();
    for (const action of comments) {
      const text = action?.data?.text;
      const prs = extractPrLinks(text);
      for (const pr of prs) {
        const key = `${pr.owner}/${pr.repo}#${pr.number}`;
        if (!links.has(key)) {
          links.set(key, pr);
        }
      }
    }
    for (const [key, pr] of links.entries()) {
      if (!results.has(key)) {
        results.set(key, { ...pr, cards: [] });
      }
      results.get(key).cards.push({
        id: card.id,
        name: card.name,
        shortUrl: card.shortUrl,
        dateLastActivity: card.dateLastActivity,
      });
    }
  }
  
  // Filter to only PRs authored by current GitHub user
  const filtered = [];
  for (const pr of results.values()) {
    try {
      const { data } = await http.get(`/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`);
      if (data.user?.login === githubLogin) {
        filtered.push({
          ...pr,
          existingLabels: Array.isArray(data.labels) ? data.labels.map((label) => label.name) : [],
        });
      }
    } catch (error) {
      console.warn(`Could not fetch PR ${pr.owner}/${pr.repo}#${pr.number}: ${error.message}`);
    }
  }
  return filtered;
}

async function ensureRejectedLabel(http, pr, labelName) {
  if (Array.isArray(pr.existingLabels) && pr.existingLabels.includes(labelName)) {
    console.log(`${pr.owner}/${pr.repo}#${pr.number}: label "${labelName}" already present; skipping.`);
    return false;
  }
  try {
    await http.post(`/repos/${pr.owner}/${pr.repo}/issues/${pr.number}/labels`, {
      labels: [labelName],
    });
    if (Array.isArray(pr.existingLabels)) {
      pr.existingLabels.push(labelName);
    }
    return true;
  } catch (error) {
    const details = error.response?.data;
    console.error(`Failed to add label "${labelName}" to ${pr.owner}/${pr.repo}#${pr.number}`);
    if (details) {
      console.error(`GitHub response: ${JSON.stringify(details)}`);
    }
    throw error;
  }
}

async function leaveRejectedComment(http, pr, message) {
  try {
    const { data } = await http.get(`/repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`, {
      params: { per_page: 100 },
    });
    const exists = Array.isArray(data) && data.some((comment) => comment.body === message);
    if (exists) {
      console.log(`${pr.owner}/${pr.repo}#${pr.number}: rejection comment already present; skipping.`);
      return false;
    }
  } catch (error) {
    const details = error.response?.data;
    console.error(`Failed to inspect comments on ${pr.owner}/${pr.repo}#${pr.number}`);
    if (details) {
      console.error(`GitHub response: ${JSON.stringify(details)}`);
    }
    throw error;
  }
  try {
    await http.post(`/repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`, {
      body: message,
    });
    return true;
  } catch (error) {
    const details = error.response?.data;
    console.error(`Failed to post comment on ${pr.owner}/${pr.repo}#${pr.number}`);
    if (details) {
      console.error(`GitHub response: ${JSON.stringify(details)}`);
    }
    throw error;
  }
}

async function main() {
  try {
    if (!GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN is required');
    }

    // Get current Trello user
    const me = await getMe();
    const myId = me.id;
    console.log(`Trello user: ${me.username || me.fullName || myId}`);

    const cards = await gatherRejectedCards(myId);
    if (cards.length === 0) {
      console.log('No cards assigned to you found in rejected lists.');
      return;
    }

    const http = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'trello-sync-rejected-script',
      },
    });

    const reviewerLogin = await getReviewerLogin(http);
    console.log(`GitHub user: ${reviewerLogin}`);

    const prs = await mapCardsToPrs(cards, http, reviewerLogin);
    if (prs.length === 0) {
      console.log('No GitHub pull requests authored by you linked from rejected cards.');
      return;
    }

    console.log('Found PRs to mark as rejected:');
    for (const pr of prs) {
      const cardSummaries = pr.cards.map((card) => `${card.name} (${card.shortUrl})`).join(', ');
      console.log(`- ${pr.owner}/${pr.repo}#${pr.number} <= ${cardSummaries}`);
    }
    for (const pr of prs) {
      const cardLinks = pr.cards
        .map((card) => {
          const activity = card.dateLastActivity ? `last activity ${card.dateLastActivity}` : 'last activity unknown';
          return `${card.name} (${card.shortUrl}) [${activity}]`;
        })
        .join(', ');
      const labelName = process.env.REJECTED_LABEL_NAME || DEFAULT_REJECTED_LABEL;
      const commentMessage = `Marked as rejected per Trello card(s): ${cardLinks}`;

      const labelAdded = await ensureRejectedLabel(http, pr, labelName);
      const commentAdded = await leaveRejectedComment(http, pr, commentMessage);

      if (labelAdded || commentAdded) {
        console.log(`${pr.owner}/${pr.repo}#${pr.number}: ${labelAdded ? `label "${labelName}" added` : 'label already present'}; ${commentAdded ? 'comment posted.' : 'comment already present.'}`);
      }
    }
  } catch (error) {
    const message = error.response?.data?.message || error.message;
    console.error(`Error: ${message}`);
    if (error.response?.data) {
      console.error(`Full GitHub response: ${JSON.stringify(error.response.data)}`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
