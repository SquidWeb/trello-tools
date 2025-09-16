require("dotenv").config();
const axios = require("axios");
const { ensureConfig, client: trelloClient, getListByName, moveCardToList, setCardDueComplete } = require('./lib/trello');
const readline = require("readline");

const {
  GITHUB_TOKEN,
  TRELLO_API_KEY,
  TRELLO_TOKEN,
  TRELLO_BOARD_ID,
  REVIEW_LIST_ID,
  REVIEW_LIST_NAME,
} = process.env;

/**
 * Replace localhost/127.0.0.1 URLs with a staging base URL
 * @param {string} text
 * @param {string} baseUrl e.g. https://ur-staging.example.com
 * @returns {string}
 */
function replaceLocalhostUrls(text, baseUrl) {
  if (!text || !baseUrl) return text;
  // Ensure no trailing slash on base
  const base = baseUrl.replace(/\/$/, "");
  // Special-case: map localhost:3002 to a fixed staging URL regardless of baseUrl
  const fixedBase3002 = 'https://artlogic.m.staging.squidweb.org'.replace(/\/$/, "");
  // 3002 with scheme
  text = text.replace(
    /(https?:\/\/)(localhost|127\.0\.0\.1):3002((?:\/[^(\s)\"]*)?[^\s\)]*)?/gi,
    (_, _scheme, _host, path) => fixedBase3002 + (path || "")
  );
  // 3002 without scheme
  text = text.replace(
    /\b(localhost|127\.0\.0\.1):3002((?:\/[^(\s)\"]*)?[^\s\)]*)?/gi,
    (_, _host, path) => fixedBase3002 + (path || "")
  );
  // Patterns to replace: with or without scheme, ports 3000 or 8080
  // 1) http(s)://localhost:PORT[/path][?q][#h]
  text = text.replace(
    /(https?:\/\/)(localhost|127\.0\.0\.1):(3000|8080)((?:\/[^(\s)\"]*)?[^\s\)]*)?/gi,
    (_, _scheme, _host, _port, path) => base + (path || "")
  );
  // 2) localhost:PORT[/path][?q][#h] without scheme
  text = text.replace(
    /\b(localhost|127\.0\.0\.1):(3000|8080)((?:\/[^(\s)\"]*)?[^\s\)]*)?/gi,
    (_, _host, _port, path) => base + (path || "")
  );
  return text;
}

/**
 * Simple CLI yes/no prompt
 * @param {string} question
 * @returns {Promise<boolean>}
 */
function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test((answer || "").trim()));
    });
  });
}

/**
 * Parse a full GitHub PR URL like:
 *   https://github.com/<owner>/<repo>/pull/<number>
 * Returns { owner, repo, number } or null if not match
 * @param {string} url
 */
function parsePrUrl(url) {
  if (!url) return null;
  const m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

/**
 * Strip HTML tags from text and collapse multiple blank lines
 * Also removes inline and block <img> tags entirely
 */
function sanitizeTestingInfo(text) {
  if (!text) return text;
  // remove <img ...>
  let out = text.replace(/<img[^>]*>/gi, "");
  // strip all other tags
  out = out.replace(/<[^>]+>/g, "");
  // remove markdown image syntax as well from testing block to avoid duplication
  out = out.replace(/!\[[^\]]*\]\([^\)]+\)/g, "");
  // trim trailing spaces per line
  out = out
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l, idx, arr) => !(l.trim() === "" && arr[idx - 1]?.trim() === ""))
    .join("\n")
    .trim();
  return out;
}

/**
 * Extract Trello card URL from PR description
 * @param {string} description - The PR description
 * @returns {string|null} - The Trello card URL or null if not found
 */
function extractTrelloUrl(description) {
  // Match Trello card URLs (both trello.com/c/ and short URLs)
  const trelloUrlRegex = /https?:\/\/(?:www\.)?trello\.com\/c\/[a-zA-Z0-9]+(?:\/[^)\s]*)?/g;
  const match = description.match(trelloUrlRegex);
  return match ? match[0] : null;
}

/**
 * Extract Trello card ID from URL
 * @param {string} url - The Trello card URL
 * @returns {string|null} - The card ID or null if not found
 */
function extractCardIdFromUrl(url) {
  const match = url.match(/\/c\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Parse PR description to extract testing information
 * @param {string} description - The PR description
 * @returns {object} - Object containing testing info and screenshots
 */
function parsePRDescription(description) {
  const lines = description.split('\n');
  let testingSection = '';
  let screenshots = [];
  let inTestingSection = false;
  let inNotesSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lowerLine = line.toLowerCase();
    
    // Check if we're entering a "Notes for me" section (exclude this)
    if (lowerLine.includes('notes for me') || lowerLine.includes('notes:')) {
      inNotesSection = true;
      inTestingSection = false;
      continue;
    }
    
    // Check if we're entering a testing section
    if (lowerLine.includes('how to test') || 
        lowerLine.includes('testing') || 
        lowerLine.includes('test instructions') ||
        lowerLine.includes('to test')) {
      inTestingSection = true;
      inNotesSection = false;
      continue;
    }
    
    // Check if we're leaving the testing section (new section header)
    if (line.startsWith('#') && inTestingSection && !lowerLine.includes('test')) {
      inTestingSection = false;
    }
    
    // Skip notes section content
    if (inNotesSection) {
      continue;
    }
    
    // Collect testing section content
    if (inTestingSection && line) {
      testingSection += line + '\n';
    }
    
    // Look for screenshots/images throughout the description (but not in notes)
    if (!inNotesSection) {
      // Match markdown images: ![alt](url)
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      while ((match = imageRegex.exec(line)) !== null) {
        screenshots.push({
          alt: match[1] || 'Screenshot',
          url: match[2]
        });
      }
      
      // Match HTML img tags: <img src="url" alt="alt">
      const htmlImageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gi;
      while ((match = htmlImageRegex.exec(line)) !== null) {
        screenshots.push({
          alt: match[2] || 'Screenshot',
          url: match[1]
        });
      }
    }
  }
  
  return {
    testingInfo: testingSection.trim(),
    screenshots: screenshots
  };
}

/**
 * Fetch GitHub PR by ID
 * @param {number} prId - The PR ID/number
 * @param {string} owner - GitHub repo owner/org
 * @param {string} repo - GitHub repository name
 * @returns {object} - The PR data
 */
async function fetchGitHubPR(prId, owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prId}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PR-to-Trello-Bot'
      }
    });
    
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`PR #${prId} not found in ${owner}/${repo}`);
    }
    throw new Error(`Failed to fetch PR: ${error.message}`);
  }
}

/**
 * Add comment to Trello card
 * @param {string} cardId - The Trello card ID
 * @param {string} comment - The comment text
 * @returns {object} - The created comment
 */
async function addTrelloComment(cardId, comment) {
  ensureConfig();
  try {
    const res = await trelloClient.post(`/cards/${cardId}/actions/comments`, null, { params: { text: comment } });
    return res.data;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Trello card not found: ${cardId}`);
    }
    throw new Error(`Failed to add comment to Trello: ${error.message}`);
  }
}
/**
 * Format the comment for Trello
 * @param {object} prData - The GitHub PR data
 * @param {string} testingInfo - The testing information
 * @param {array} screenshots - Array of screenshot objects
 * @returns {string} - The formatted comment
 */
function formatTrelloComment(prData, testingInfo, screenshots, options = {}) {
  const includeTesting = options.includeTesting !== false;
  // Default to links-only unless explicitly set to false
  const linksOnly = options.linksOnly !== false;
  let comment = `Converted from GitHub PR (autogenerated)\n\n`;
  // Keep it simple and less bold
  comment += `PR #${prData.number}: ${prData.title}\n`;
  comment += `PR: ${prData.html_url}\n\n`;

  if (includeTesting && testingInfo) {
    comment += `How to test:\n${testingInfo}\n\n`;
  }

  if (screenshots.length > 0) {
    comment += `Screenshots:\n`;
    screenshots.forEach((screenshot) => {
      if (linksOnly) {
        comment += `- ${screenshot.url}\n`;
      } else {
        // Try inline image, with link fallback on next line
        const alt = screenshot.alt || 'Screenshot';
        comment += `![${alt}](${screenshot.url})\n`;
        comment += `<${screenshot.url}>\n`;
      }
    });
    comment += `\n`;
  }

  comment += `---\nAutomatically added from GitHub PR #${prData.number}`;

  return comment;
}

/**
 * Main function to process PR and update Trello
 * @param {number} prId - The GitHub PR ID
 * @param {string} owner - GitHub repo owner/org
 * @param {string} repo - GitHub repository name
 */
async function processPRToTrello(prId, owner, repo) {
  console.log(`🔄 Processing PR #${prId} for ${owner}/${repo}...`);
  
  try {
    // Validate environment variables
    if (!GITHUB_TOKEN) {
      throw new Error('Missing GitHub configuration. Please set GITHUB_TOKEN in your .env file.');
    }
    if (!owner || !repo) {
      throw new Error('Missing repository. Provide owner/repo via CLI, e.g. "node pr-to-trello.js 123 myorg/myrepo"');
    }
    
    if (!TRELLO_API_KEY || !TRELLO_TOKEN) {
      throw new Error('Missing Trello configuration. Please check TRELLO_API_KEY and TRELLO_TOKEN in your .env file.');
    }
    
    // Step 1: Fetch GitHub PR
    console.log('📥 Fetching GitHub PR...');
    const prData = await fetchGitHubPR(prId, owner, repo);
    console.log(`✅ Found PR: "${prData.title}"`);
    
    // Step 2: Extract Trello URL from PR description
    console.log('🔍 Looking for Trello card URL...');
    const trelloUrl = extractTrelloUrl(prData.body || '');
    
    if (!trelloUrl) {
      throw new Error('No Trello card URL found in PR description');
    }
    
    console.log(`✅ Found Trello URL: ${trelloUrl}`);
    
    // Step 3: Extract card ID from URL
    const cardId = extractCardIdFromUrl(trelloUrl);
    if (!cardId) {
      throw new Error('Could not extract card ID from Trello URL');
    }
    
    console.log(`✅ Extracted card ID: ${cardId}`);
    
    // Step 4: Parse PR description for testing info
    console.log('📝 Parsing PR description...');
    let { testingInfo, screenshots } = parsePRDescription(prData.body || '');

    // Replace localhost URLs with staging base URL if provided
    const stagingBase = process.env.UR_STAGING_BASE_URL;
    if (stagingBase) {
      testingInfo = replaceLocalhostUrls(testingInfo, stagingBase);
      screenshots = (screenshots || []).map((s) => ({
        ...s,
        url: replaceLocalhostUrls(s.url, stagingBase),
      }));
    }

    // Sanitize testing info: strip HTML and image embeds
    testingInfo = sanitizeTestingInfo(testingInfo);
    
    if (!testingInfo && screenshots.length === 0) {
      console.log('⚠️  No testing information or screenshots found in PR description');
      return;
    }
    
    console.log(`✅ Found testing info: ${testingInfo ? 'Yes' : 'No'}`);
    console.log(`✅ Found screenshots: ${screenshots.length}`);
    
    // Step 5: Format comment
    const skipTesting = process.argv.includes("--no-test");
    // Default to links-only; use --inline to embed images
    const useInline = process.argv.includes("--inline");
    const comment = formatTrelloComment(prData, testingInfo, screenshots, { includeTesting: !skipTesting, linksOnly: !useInline });

    // Show preview and ask for confirmation unless --yes provided
    if (!process.argv.includes("--yes")) {
      console.log("\n===== Trello Comment Preview =====\n");
      console.log(comment);
      console.log("\n==================================\n");
      const ok = await promptYesNo("Post this comment to Trello?");
      if (!ok) {
        console.log("🚫 Aborted by user. Nothing was posted.");
        return;
      }
    }

    // Step 6: Add comment to Trello card
    console.log('💬 Adding comment to Trello card...');
    await addTrelloComment(cardId, comment);
    
    console.log('🎉 Successfully added testing information to Trello card!');
    console.log(`📋 Trello card: ${trelloUrl}`);

    // Ask about PR state - only optionally move to review and mark complete
    const moveToReview = await promptYesNo('Move card to "Ready for review & testing (developers)" and mark complete?');

    async function resolveListId(target) {
      if (target === 'review') {
        if (REVIEW_LIST_ID) return REVIEW_LIST_ID;
        if (!TRELLO_BOARD_ID) throw new Error('Set REVIEW_LIST_ID or provide TRELLO_BOARD_ID to resolve REVIEW_LIST_NAME');
        const list = await getListByName(TRELLO_BOARD_ID, REVIEW_LIST_NAME || 'Ready for review & testing (developers)');
        if (!list) throw new Error(`Cannot find list named "${REVIEW_LIST_NAME || 'Ready for review & testing (developers)'}" on board ${TRELLO_BOARD_ID}`);
        return list.id;
      }
      throw new Error(`Unknown target: ${target}. Use 'review'.`);
    }

    if (moveToReview) {
      console.log('🔁 Moving card to review and marking complete...');
      try {
        const listId = await resolveListId('review');
        console.log(`— Moving card to "Ready for review & testing (developers)" (list ${listId})...`);
        await moveCardToList(cardId, listId);
        console.log('   ✅ Moved');

        console.log('— Setting dueComplete=true...');
        await setCardDueComplete(cardId, true);
        console.log('   ✅ Marked complete');
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
      }
    } else {
      console.log('ℹ️  No state changes made.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Command line usage
if (require.main === module) {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  let prId, owner, repo;
  const parsed = parsePrUrl(arg1);
  if (parsed) {
    prId = parsed.number;
    owner = parsed.owner;
    repo = parsed.repo;
  } else if (arg1 && !isNaN(arg1) && arg2 && arg2.includes('/')) {
    prId = parseInt(arg1, 10);
    [owner, repo] = arg2.split('/', 2);
  } else {
    console.error('Usage:');
    console.error('  node pr-to-trello.js <PR_URL> [--yes]');
    console.error('  node pr-to-trello.js <PR_ID> <owner/repo> [--yes]');
    console.error('Examples:');
    console.error('  node pr-to-trello.js https://github.com/myorg/myrepo/pull/1234');
    console.error('  node pr-to-trello.js 1234 myorg/myrepo');
    process.exit(1);
  }

  processPRToTrello(prId, owner, repo);
}

module.exports = {
  processPRToTrello,
  extractTrelloUrl,
  extractCardIdFromUrl,
  parsePRDescription,
  formatTrelloComment,
  replaceLocalhostUrls,
  parsePrUrl
};
