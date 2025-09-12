#!/usr/bin/env node
/*
  Trello Card Exporter
  Exports Trello card information to a local folder with markdown and screenshots
*/

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { getCard, getCardComments, getCardAttachments, getCardChecklists, ensureConfig } = require('./lib/trello');

// Create authenticated axios client for downloads (similar to trello client but without baseURL)
const downloadClient = axios.create();
downloadClient.interceptors.request.use((config) => {
  const params = new URLSearchParams(config.params || {});
  params.set('key', process.env.TRELLO_API_KEY);
  params.set('token', process.env.TRELLO_TOKEN);
  return { ...config, params };
});

/**
 * Parse Trello card URL to extract card ID
 * @param {string} url - The Trello card URL
 * @returns {string|null} - The card ID or null if not found
 */
function parseTrelloUrl(url) {
  if (!url) return null;

  // Match various Trello URL formats
  const patterns = [
    /\/c\/([a-zA-Z0-9]+)/,  // /c/cardId format
    /\/cards\/([a-zA-Z0-9]+)/,  // /cards/cardId format
    /card\/([a-zA-Z0-9]+)/,  // card/cardId format
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Sanitize filename to remove invalid characters
 * @param {string} name - The original name
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')  // Replace invalid filename chars
    .replace(/\s+/g, '_')           // Replace spaces with underscores
    .replace(/_{2,}/g, '_')         // Replace multiple underscores with single
    .substring(0, 100);             // Limit length
}

/**
 * Download a file from URL to local path
 * @param {string} url - The URL to download from
 * @param {string} filepath - The local file path to save to
 */
async function downloadFile(url, filepath) {
  try {
    const response = await downloadClient({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = require('fs').createWriteStream(filepath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.warn(`⚠️  Failed to download ${url}: ${error.message}`);
  }
}

/**
 * Check if attachment is an image
 * @param {object} attachment - The Trello attachment object
 * @returns {boolean} - True if it's an image
 */
function isImageAttachment(attachment) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
  const url = attachment.url || attachment.previews?.[0]?.url || '';
  const extension = path.extname(url.toLowerCase());
  return imageExtensions.includes(extension) || attachment.mimeType?.startsWith('image/');
}

/**
 * Format comments for markdown
 * @param {array} comments - Array of comment objects
 * @returns {string} - Formatted comments
 */
function formatComments(comments) {
  if (!comments || comments.length === 0) return '';

  let formatted = '## Comments\n\n';

  comments.forEach((comment, index) => {
    const memberCreator = comment.memberCreator || {};
    const fullName = memberCreator.fullName || memberCreator.username || 'Unknown';
    const date = new Date(comment.date).toLocaleString();

    formatted += `### Comment ${index + 1} by ${fullName} (${date})\n\n`;
    formatted += `${comment.data.text}\n\n`;
  });

  return formatted;
}

/**
 * Format checklists for markdown
 * @param {array} checklists - Array of checklist objects
 * @returns {string} - Formatted checklists
 */
function formatChecklists(checklists) {
  if (!checklists || checklists.length === 0) return '';

  let formatted = '';

  // Separate dev checklists for special emphasis
  const devChecklists = checklists.filter(c => c.name.toLowerCase().includes('dev'));
  const otherChecklists = checklists.filter(c => !c.name.toLowerCase().includes('dev'));

  // Process dev checklists first (they get priority as mentioned by user)
  if (devChecklists.length > 0) {
    formatted += '## Developer Tasks (Dev Checklists)\n\n';
    formatted += '> **🎯 Priority Focus:** These are the core development tasks to complete.\n\n';

    devChecklists.forEach((checklist) => {
      formatted += formatSingleChecklist(checklist, true);
    });
  }

  // Process other checklists
  if (otherChecklists.length > 0) {
    if (devChecklists.length > 0) {
      formatted += '## Other Checklists\n\n';
    } else {
      formatted += '## Checklists\n\n';
    }

    otherChecklists.forEach((checklist) => {
      formatted += formatSingleChecklist(checklist, false);
    });
  }

  return formatted;
}

/**
 * Format a single checklist
 * @param {object} checklist - The checklist object
 * @param {boolean} isDev - Whether this is a dev checklist
 * @returns {string} - Formatted checklist
 */
function formatSingleChecklist(checklist, isDev = false) {
  let formatted = `### ${checklist.name}\n\n`;

  if (checklist.checkItems && checklist.checkItems.length > 0) {
    const completed = checklist.checkItems.filter(item => item.state === 'complete').length;
    const total = checklist.checkItems.length;

    formatted += `**Progress:** ${completed}/${total} completed\n\n`;

    checklist.checkItems.forEach((item) => {
      const checked = item.state === 'complete' ? 'x' : ' ';
      const emoji = isDev ? (item.state === 'complete' ? '✅' : '⏳') : (item.state === 'complete' ? '☑️' : '☐');
      formatted += `- ${emoji} ${item.name}\n`;
    });
  } else {
    formatted += '*No items in this checklist*\n';
  }

  formatted += '\n';
  return formatted;
}

/**
 * Main function to export Trello card
 * @param {string} trelloUrl - The Trello card URL
 */
async function exportTrelloCard(trelloUrl) {
  console.log(`🔄 Processing Trello card: ${trelloUrl}`);

  try {
    // Validate environment
    ensureConfig();

    // Parse URL to get card ID
    const cardId = parseTrelloUrl(trelloUrl);
    if (!cardId) {
      throw new Error('Could not extract card ID from Trello URL');
    }

    console.log(`✅ Extracted card ID: ${cardId}`);

    // Fetch card details
    console.log('📥 Fetching card details...');
    const card = await getCard(cardId);
    console.log(`✅ Found card: "${card.name}"`);

    // Fetch comments
    console.log('📝 Fetching comments...');
    const comments = await getCardComments(cardId);
    console.log(`✅ Found ${comments.length} comments`);

    // Fetch attachments
    console.log('🖼️  Fetching attachments...');
    const attachments = await getCardAttachments(cardId);
    const imageAttachments = attachments.filter(isImageAttachment);
    console.log(`✅ Found ${attachments.length} attachments (${imageAttachments.length} images)`);

    // Fetch checklists
    console.log('📋 Fetching checklists...');
    const checklists = await getCardChecklists(cardId);
    console.log(`✅ Found ${checklists.length} checklists`);

    // Create folder
    const folderName = sanitizeFilename(card.name);
    const cardFolder = path.join(process.cwd(), folderName);

    console.log(`📁 Creating folder: ${folderName}`);
    await fs.mkdir(cardFolder, { recursive: true });

    // Download screenshots
    if (imageAttachments.length > 0) {
      console.log('⬇️  Downloading screenshots...');
      const screenshotsDir = path.join(cardFolder, 'screenshots');
      await fs.mkdir(screenshotsDir, { recursive: true });

      for (let i = 0; i < imageAttachments.length; i++) {
        const attachment = imageAttachments[i];
        // Prefer original Trello fileName if present
        const localFileName = attachment.fileName
          ? attachment.fileName
          : `screenshot_${i + 1}${path.extname(attachment.url || attachment.previews?.[0]?.url || '.png')}`;
        const filename = sanitizeFilename(localFileName);
        const filepath = path.join(screenshotsDir, filename);

        // Build API download URL explicitly to avoid trello.com cookie auth
        const safeFileName = encodeURIComponent(attachment.fileName || filename);
        const apiDownloadUrl = `https://api.trello.com/1/cards/${card.id}/attachments/${attachment.id}/download/${safeFileName}`;

        console.log(`  Downloading ${filename}...`);
        await downloadFile(apiDownloadUrl, filepath);
      }
    }

    // Generate markdown
    console.log('📄 Generating markdown...');
    let markdown = `# ${card.name}\n\n`;

    // Add description
    if (card.desc) {
      markdown += `## Description\n\n${card.desc}\n\n`;
    }

    // Add metadata
    markdown += `## Metadata\n\n`;
    markdown += `- **URL**: ${card.url}\n`;
    if (card.due) {
      markdown += `- **Due Date**: ${new Date(card.due).toLocaleString()}\n`;
    }
    if (card.dueComplete) {
      markdown += `- **Due Complete**: Yes\n`;
    }
    if (card.labels && card.labels.length > 0) {
      markdown += `- **Labels**: ${card.labels.map(l => l.name).join(', ')}\n`;
    }
    markdown += '\n';

    // Add screenshots section
    if (imageAttachments.length > 0) {
      markdown += `## Screenshots\n\n`;
      for (let i = 0; i < imageAttachments.length; i++) {
        const attachment = imageAttachments[i];
        const localFileName = attachment.fileName
          ? sanitizeFilename(attachment.fileName)
          : `screenshot_${i + 1}${path.extname(attachment.url || attachment.previews?.[0]?.url || '.png')}`;
        markdown += `![${attachment.name || `Screenshot ${i + 1}`}](${path.join('screenshots', localFileName)})\n\n`;
      }
    }

    // Add comments
    if (comments.length > 0) {
      markdown += formatComments(comments);
    }

    // Add checklists (with special emphasis on dev checklists)
    if (checklists.length > 0) {
      markdown += formatChecklists(checklists);
    }

    // Write markdown file
    const markdownPath = path.join(cardFolder, 'card.md');
    await fs.writeFile(markdownPath, markdown, 'utf8');

    console.log('🎉 Successfully exported Trello card!');
    console.log(`📁 Folder created: ${folderName}`);
    console.log(`📄 Markdown file: ${path.join(folderName, 'card.md')}`);
    if (imageAttachments.length > 0) {
      console.log(`🖼️  Screenshots: ${path.join(folderName, 'screenshots')} (${imageAttachments.length} files)`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Command line usage
if (require.main === module) {
  const trelloUrl = process.argv[2];

  if (!trelloUrl) {
    console.error('Usage: node trello-export.js <TRELLO_CARD_URL>');
    console.error('Example: node trello-export.js https://trello.com/c/abc123/my-card-name');
    process.exit(1);
  }

  exportTrelloCard(trelloUrl);
}

module.exports = {
  exportTrelloCard,
  parseTrelloUrl,
  sanitizeFilename,
  isImageAttachment,
  formatComments,
  formatChecklists,
  formatSingleChecklist
};
