#!/usr/bin/env node
/*
  catalog.js — List available CLI tools in this repository

  Purpose
  -------
  Scans the project directory, finds executable Node.js scripts (excluding library
  folders), extracts their top docblock (if available), and prints a readable
  catalog of available tools along with how to run them via `node` or `npm run`.

  Usage
  -----
    node catalog.js [--json] [--md]

  Options
  -------
  --json   Output machine-readable JSON
  --md     Output Markdown table

*/

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const IGNORED_DIRS = new Set(['node_modules', '.git', 'lib', 'screenshots']);

function readPackageJson() {
  const pkgPath = path.join(ROOT, 'package.json');
  try { return JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { return {}; }
}

function listJsFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full);

    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue;
      out.push(...listJsFiles(full));
    } else if (e.isFile()) {
      if (!e.name.endsWith('.js')) continue;
      // Exclude this catalog file itself
      if (rel === 'catalog.js') continue;
      out.push(rel);
    }
  }
  return out;
}

function extractTopDocBlock(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Allow shebang on first line
    const startIdx = content.startsWith('#!') ? content.indexOf('\n') + 1 : 0;
    const afterShebang = content.slice(startIdx);
    const match = afterShebang.match(/^\/\*[\s\S]*?\*\//);
    if (!match) return null;
    const block = match[0]
      .replace(/^\/\*/,'')
      .replace(/\*\/$/,'')
      .split('\n')
      .map(l => l.replace(/^\s*\*?\s?/, ''))
      .join('\n')
      .trim();

    // First non-empty line as title, rest as description
    const lines = block.split(/\r?\n/);
    const firstNonEmptyIdx = lines.findIndex(l => l.trim().length > 0);
    const title = firstNonEmptyIdx >= 0 ? lines[firstNonEmptyIdx].trim() : '';
    const desc = lines.slice(firstNonEmptyIdx + 1).join('\n').trim();
    return { title, desc, raw: block };
  } catch {
    return null;
  }
}

function mapScriptsToFiles(pkg) {
  const result = new Map(); // file -> scriptName(s)
  const scripts = (pkg && pkg.scripts) || {};
  for (const [name, cmd] of Object.entries(scripts)) {
    // Very simple heuristics: look for `node <file>.js`
    const m = cmd.match(/node\s+([^\s]+\.js)(?:\s|$)/);
    if (m) {
      const rel = path.normalize(m[1]);
      const key = rel;
      const arr = result.get(key) || [];
      arr.push(name);
      result.set(key, arr);
    }
  }
  return result;
}

function buildCatalog() {
  const pkg = readPackageJson();
  const scriptMap = mapScriptsToFiles(pkg);
  const files = listJsFiles(ROOT);
  const items = [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const meta = extractTopDocBlock(abs);
    const scripts = scriptMap.get(rel) || [];
    const name = path.basename(rel, '.js');
    const title = (meta && meta.title) ? meta.title : `${name}.js`;
    const desc = (meta && meta.desc) ? meta.desc : '';
    items.push({ file: rel, name, title, description: desc, npmScripts: scripts });
  }
  // Sort by name
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

function printPretty(items) {
  console.log('📚 Available tools');
  console.log('');
  for (const it of items) {
    console.log(`- ${it.title}`);
    if (it.description) {
      const firstPara = it.description.split(/\n{2,}/)[0].replace(/\n/g, ' ');
      console.log(`  ${firstPara}`);
    }
    console.log(`  File: ${it.file}`);
    const nodeCmd = `node ${it.file}`;
    const npmPart = it.npmScripts.length > 0 ? ` | npm run ${it.npmScripts[0]}` : '';
    console.log(`  Run:  ${nodeCmd}${npmPart}`);
    console.log('');
  }
}

function printMarkdown(items) {
  console.log('| Name | File | Run |');
  console.log('|------|------|-----|');
  for (const it of items) {
    const run = it.npmScripts.length > 0 ? `npm run ${it.npmScripts[0]}` : `node ${it.file}`;
    console.log(`| ${it.name} | ${it.file} | ${run} |`);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const items = buildCatalog();
  if (args.has('--json')) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  if (args.has('--md')) {
    printMarkdown(items);
    return;
  }
  printPretty(items);
}

if (require.main === module) {
  main();
}

module.exports = { buildCatalog };
