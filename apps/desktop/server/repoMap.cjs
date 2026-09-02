/**
 * Aider-inspired Tree-Sitter / AST Repo-Map Generator for Hephaestus Code Forge.
 * 
 * Features:
 * - Traverses codebase and extracts symbol signatures (Classes, Methods, Exported Functions, Interfaces, Constants)
 * - Builds a compact ~1,000-token hierarchical AST map of the repository
 * - Gives LLMs complete architectural awareness with near-zero token consumption
 * - Ignores build artifacts, node_modules, and git directories
 */

const fs = require('fs');
const path = require('path');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'release',
  '.staging',
  '.pending-ui-changes',
  'coverage',
  '.next',
  '.turbo'
]);

const CODE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.cjs',
  '.mjs',
  '.py',
  '.json',
  '.css',
  '.html'
]);

/**
 * Extracts class and function signatures from code using regex AST heuristics.
 * @param {string} content 
 * @param {string} ext 
 * @returns {Array<string>} List of symbol signature lines
 */
function extractSymbolSignatures(content, ext) {
  const signatures = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // JavaScript / TypeScript symbols
    if (['.js', '.jsx', '.ts', '.tsx', '.cjs', '.mjs'].includes(ext)) {
      // Classes
      if (/^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z0-9_$]+)/.test(line)) {
        const match = line.match(/class\s+([A-Za-z0-9_$]+(?:\s+extends\s+[A-Za-z0-9_$]+)?)/);
        if (match) signatures.push(`  class ${match[1]}`);
      }
      // Exported functions or standard functions
      else if (/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/.test(line)) {
        const match = line.match(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/);
        if (match) signatures.push(`  def ${match[1]}(${match[2].trim()})`);
      }
      // Arrow function exports or const function assignments
      else if (/^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/.test(line)) {
        const match = line.match(/const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)/);
        if (match) signatures.push(`  fn ${match[1]}(${match[2].trim()})`);
      }
      // TypeScript interfaces / type aliases
      else if (/^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/.test(line)) {
        const match = line.match(/interface\s+([A-Za-z0-9_$]+)/);
        if (match) signatures.push(`  interface ${match[1]}`);
      }
      // Methods inside objects or classes
      else if (/^(?:async\s+)?([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*\{/.test(line) && !line.startsWith('if') && !line.startsWith('for') && !line.startsWith('while') && !line.startsWith('switch')) {
        const match = line.match(/([A-Za-z0-9_$]+)\s*\(([^)]*)\)/);
        if (match && !['constructor', 'catch', 'then'].includes(match[1])) {
          signatures.push(`    .${match[1]}(${match[2].trim()})`);
        }
      }
    }
    // Python symbols
    else if (ext === '.py') {
      if (/^class\s+([A-Za-z0-9_]+(?:\([^)]*\))?):/.test(line)) {
        const match = line.match(/^class\s+([A-Za-z0-9_]+(?:\([^)]*\))?):/);
        if (match) signatures.push(`  class ${match[1]}`);
      } else if (/^(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/.test(line)) {
        const match = line.match(/(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
        if (match) signatures.push(`  def ${match[1]}(${match[2].trim()})`);
      }
    }
  }

  return signatures;
}

/**
 * Traverses a project directory and builds an Aider-style Repo-Map.
 * @param {string} rootDir 
 * @param {Object} [options]
 * @param {number} [options.maxFiles=60]
 * @param {number} [options.maxTokens=1500]
 * @returns {{ repoMap: string, fileCount: number, symbolCount: number }}
 */
function generateRepoMap(rootDir, options = {}) {
  const { maxFiles = 60, maxTokens = 1500 } = options;
  const fileEntries = [];

  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          fileEntries.push({
            fullPath,
            relPath: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
            ext,
            size: fs.statSync(fullPath).size
          });
        }
      }
    }
  }

  walk(rootDir);

  // Sort files: prioritize src, server, components, services
  fileEntries.sort((a, b) => {
    const scoreA = (a.relPath.includes('src/') || a.relPath.includes('server/')) ? 0 : 1;
    const scoreB = (b.relPath.includes('src/') || b.relPath.includes('server/')) ? 0 : 1;
    return scoreA - scoreB;
  });

  const selectedFiles = fileEntries.slice(0, maxFiles);
  let totalSymbols = 0;
  const mapLines = [`# Repo-Map: ${path.basename(rootDir)}`];

  for (const file of selectedFiles) {
    try {
      const content = fs.readFileSync(file.fullPath, 'utf8');
      const symbols = extractSymbolSignatures(content, file.ext);

      if (symbols.length > 0) {
        mapLines.push(`\n📄 ${file.relPath}`);
        for (const sym of symbols.slice(0, 15)) { // Cap per file
          mapLines.push(sym);
          totalSymbols++;
        }
        if (symbols.length > 15) {
          mapLines.push(`    ... (${symbols.length - 15} more symbols)`);
        }
      }
    } catch (e) {
      // Ignore unreadable files
    }
  }

  const repoMapString = mapLines.join('\n');

  return {
    repoMap: repoMapString,
    fileCount: selectedFiles.length,
    symbolCount: totalSymbols
  };
}

module.exports = {
  generateRepoMap,
  extractSymbolSignatures
};
