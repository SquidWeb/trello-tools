#!/usr/bin/env node
/*
  Shared Trello helpers used by scripts in this repo.
  - Centralizes axios client with key/token
  - Exposes common functions for members, lists, and cards
*/

const axios = require('axios');
require('dotenv').config();

const {
  TRELLO_API_KEY,
  TRELLO_TOKEN,
} = process.env;

function ensureConfig() {
  if (!TRELLO_API_KEY || !TRELLO_TOKEN) {
    throw new Error('Missing Trello configuration. Please set TRELLO_API_KEY and TRELLO_TOKEN in your .env');
  }
}

// Axios client that automatically appends key/token to params
const client = axios.create({ 
  baseURL: 'https://api.trello.com/1',
  timeout: 10000 // 10 second timeout
});
client.interceptors.request.use((config) => {
  const params = new URLSearchParams(config.params || {});
  params.set('key', TRELLO_API_KEY);
  params.set('token', TRELLO_TOKEN);
  return { ...config, params };
});

// Members
async function getMe() {
  ensureConfig();
  const { data } = await client.get('/members/me');
  return data;
}

// Lists
async function getBoardLists(boardId, { includeClosed = false } = {}) {
  ensureConfig();
  const { data } = await client.get(`/boards/${boardId}/lists`, { params: { cards: 'none' } });
  return includeClosed ? data : data.filter((l) => !l.closed);
}

async function getListByName(boardId, name) {
  const lists = await getBoardLists(boardId, { includeClosed: false });
  const lower = (name || '').toLowerCase();
  return lists.find((l) => (l.name || '').toLowerCase() === lower) || null;
}

async function resolveDoneListId(boardLists, doneId, doneName) {
  if (doneId) return doneId;
  if (doneName) {
    const found = boardLists.find((l) => (l.name || '').toLowerCase() === doneName.toLowerCase());
    if (found) return found.id;
  }
  return null;
}

// Cards
async function getListCards(listId, fields = ['name','url','due','dueComplete','closed','idList','idMembers']) {
  ensureConfig();
  const { data } = await client.get(`/lists/${listId}/cards`, {
    params: { fields: fields.join(',') }
  });
  return data;
}

async function getCardsInLists(listIds, fields) {
  const all = [];
  for (const id of listIds) {
    const cards = await getListCards(id, fields);
    all.push(...cards);
  }
  return all;
}

// Board-level
async function getBoardCards(boardId, fields = ['id','name','shortUrl','dateLastActivity','idMembers','idList'], extraParams = {}) {
  ensureConfig();
  const { data } = await client.get(`/boards/${boardId}/cards`, {
    params: {
      fields: fields.join(','),
      ...extraParams,
    },
  });
  return data;
}

async function getListNameById(boardId, listId) {
  const lists = await getBoardLists(boardId, { includeClosed: false });
  const m = new Map(lists.map((l) => [l.id, l.name]));
  return m.get(listId) || 'Unknown';
}

async function moveCardToList(cardId, listId) {
  ensureConfig();
  const { data } = await client.put(`/cards/${cardId}`, null, { params: { idList: listId } });
  return data;
}

async function setCardDueComplete(cardId, dueComplete) {
  ensureConfig();
  const { data } = await client.put(`/cards/${cardId}`, null, { params: { dueComplete } });
  return data;
}

async function updateCardDue(cardId, newDueIso) {
  ensureConfig();
  const { data } = await client.put(`/cards/${cardId}`, null, { params: { due: newDueIso } });
  return data;
}

// Get detailed card information including description
async function getCard(cardId, fields = ['id', 'name', 'desc', 'url', 'due', 'dueComplete', 'idList', 'idMembers', 'labels']) {
  ensureConfig();
  const { data } = await client.get(`/cards/${cardId}`, {
    params: { fields: fields.join(',') }
  });
  return data;
}

// Get card comments
async function getCardComments(cardId) {
  ensureConfig();
  const { data } = await client.get(`/cards/${cardId}/actions`, {
    params: { filter: 'commentCard' }
  });
  return data;
}

// Get card attachments
async function getCardAttachments(cardId) {
  ensureConfig();
  const { data } = await client.get(`/cards/${cardId}/attachments`);
  return data;
}

async function addCardAttachment(cardId, { url, name }) {
  ensureConfig();
  if (!url) {
    throw new Error('Attachment url is required');
  }
  const params = { url };
  if (name) {
    params.name = name;
  }
  const { data } = await client.post(`/cards/${cardId}/attachments`, null, { params });
  return data;
}

async function getCardChecklists(cardId) {
  ensureConfig();
  const { data } = await client.get(`/cards/${cardId}/checklists`);
  return data;
}

// Get card checklists
// Advanced: fetch card with pluginData and customFieldItems included
async function getCardFull(cardId, fields = ['all']) {
  ensureConfig();
  const { data } = await client.get(`/cards/${cardId}`, {
    params: {
      fields: fields.join(','),
      pluginData: true,
      customFieldItems: true,
    },
  });
  return data;
}

// Board-level: fetch cards including pluginData (useful for Power-Ups like Planyway)
async function getBoardCardsWithPluginData(boardId, fields = ['id','name','shortUrl','idList','dateLastActivity']) {
  ensureConfig();
  const { data } = await client.get(`/boards/${boardId}/cards`, {
    params: {
      fields: fields.join(','),
      pluginData: true,
      customFieldItems: true,
    },
  });
  return data;
}

// Generic actions fetcher (not only comments)
async function getCardActions(cardId, { filter = 'all', limit = 1000 } = {}) {
  ensureConfig();
  const { data } = await client.get(`/cards/${cardId}/actions`, {
    params: { filter, limit },
  });
  return data;
}

module.exports = {
  ensureConfig,
  client,
  getMe,
  getBoardLists,
  getListByName,
  getListCards,
  getCardsInLists,
  getBoardCards,
  getListNameById,
  moveCardToList,
  setCardDueComplete,
  updateCardDue,
  getCard,
  getCardComments,
  getCardAttachments,
  addCardAttachment,
  getCardChecklists,
  getCardFull,
  getBoardCardsWithPluginData,
  getCardActions,
  resolveDoneListId,
};
