// Aloy Self-Diagnostic & Automated Health Check Suite
// Runs live diagnostic tests on Aloy's core services, local LLM, APIs, memory bank, and tools.
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const HA_URL = process.env.HA_URL || 'http://localhost:8123';
const HA_TOKEN = process.env.VITE_HA_TOKEN;

async function runSelfDiagnostics() {
  const report = {
    timestamp: new Date().toISOString(),
    testsPassed: 0,
    testsFailed: 0,
    warnings: 0,
    details: [],
    issues: []
  };

  function logPass(name, message) {
    report.testsPassed++;
    report.details.push({ name, status: 'PASS', message });
  }

  function logFail(name, error, criticality = 'HIGH') {
    report.testsFailed++;
    report.details.push({ name, status: 'FAIL', error: String(error) });
    report.issues.push({ name, error: String(error), criticality });
  }

  function logWarn(name, warning) {
    report.warnings++;
    report.details.push({ name, status: 'WARN', warning });
  }

  console.log('🤖 Running Aloy Self-Diagnostic Test Suite...\n');

  // 1. Ollama Connection & Model Check
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      logPass('Ollama Server Connection', `Online at ${OLLAMA_URL}. Available models: ${models.join(', ')}`);

      // Check nomic-embed-text
      if (models.some(m => m.includes('nomic-embed-text'))) {
        logPass('Ollama Embedding Model', 'nomic-embed-text model is installed.');
      } else {
        logWarn('Ollama Embedding Model', 'nomic-embed-text model not found in /api/tags list.');
      }
    } else {
      logFail('Ollama Server Connection', `HTTP ${res.status}: ${res.statusText}`);
    }
  } catch (err) {
    logFail('Ollama Server Connection', `Failed to connect to Ollama at ${OLLAMA_URL}: ${err.message}`);
  }

  // 2. Ollama Vector Embeddings Generation Test
  try {
    const { getEmbedding } = require('./confidenceEscalation.cjs');
    const embedding = await getEmbedding('Self-test embedding prompt');
    if (embedding && Array.isArray(embedding) && embedding.length > 0) {
      logPass('Vector Embedding Generation', `Generated vector embedding (${embedding.length} dimensions).`);
    } else {
      logFail('Vector Embedding Generation', 'Returned null or empty embedding array.');
    }
  } catch (err) {
    logFail('Vector Embedding Generation', err.message);
  }

  // 3. Confidence Evaluator YES/NO Logprob Test
  try {
    const { getConfidenceLabel } = require('./confidenceEscalation.cjs');
    const result = await getConfidenceLabel({
      model: 'gemma4:12b',
      question: 'Is Paris the capital of France?',
      answer: 'Paris is the capital of France.'
    });
    if (result && result.label === 'YES' && !result.lowConfidence) {
      logPass('Confidence Check (Correct Answer)', `Self-rated YES with probability ${result.probability?.toFixed(3)}.`);
    } else {
      logWarn('Confidence Check (Correct Answer)', `Unexpected label ${result.label} (lowConfidence: ${result.lowConfidence})`);
    }
  } catch (err) {
    logFail('Confidence Check Evaluator', err.message);
  }

  // 4. Anthropic API (Claude Escalation) Check
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const { escalateToClaude } = require('./confidenceEscalation.cjs');
      const response = await escalateToClaude({
        question: 'Self-test diagnostic ping: reply with OK',
        localAnswer: 'Self-test proposed response'
      });
      if (response && response.length > 0) {
        logPass('Anthropic Claude API', `Claude responded successfully (${response.slice(0, 50)}...).`);
      } else {
        logFail('Anthropic Claude API', 'Claude returned empty text response.');
      }
    } else {
      logWarn('Anthropic Claude API', 'ANTHROPIC_API_KEY is not set in environment.');
    }
  } catch (err) {
    logFail('Anthropic Claude API', err.message);
  }

  // 5. Gemini API (Verification Fallback) Check
  try {
    if (process.env.GEMINI_API_KEY) {
      const { verifyWithGemini } = require('./geminiVerification.cjs');
      const verification = await verifyWithGemini({
        topic: 'Speed of Light',
        summary: 'The speed of light in vacuum is approximately 299,792,458 meters per second.'
      });
      if (verification) {
        logPass('Gemini Verification API', `Gemini verified statement (Confident: ${verification.confident}).`);
      } else {
        logFail('Gemini Verification API', 'Gemini returned empty verification response.');
      }
    } else {
      logWarn('Gemini Verification API', 'GEMINI_API_KEY is not set in environment.');
    }
  } catch (err) {
    logFail('Gemini Verification API', err.message);
  }

  // 6. Home Assistant Connection Check
  try {
    if (HA_TOKEN) {
      const res = await fetch(`${HA_URL}/api/`, {
        headers: { Authorization: `Bearer ${HA_TOKEN}` },
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data = await res.json();
        logPass('Home Assistant API', `Connected to Home Assistant at ${HA_URL} (${data.message || 'API OK'}).`);
      } else {
        logFail('Home Assistant API', `HTTP ${res.status}: ${res.statusText}`);
      }
    } else {
      logWarn('Home Assistant API', 'VITE_HA_TOKEN is not configured.');
    }
  } catch (err) {
    logFail('Home Assistant API', `Failed to reach Home Assistant: ${err.message}`, 'MEDIUM');
  }

  // 7. Whisper Speech Recognition Server Check (Port 8890)
  try {
    const res = await fetch('http://localhost:8890/', { method: 'GET', signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (res) {
      logPass('Whisper STT Server', 'Whisper STT service reachable on port 8890.');
    } else {
      logWarn('Whisper STT Server', 'Whisper server on port 8890 is currently offline or unreachable.');
    }
  } catch (err) {
    logWarn('Whisper STT Server', err.message);
  }

  // 8. Markdown Vault Sync Test
  try {
    const { syncToVault } = require('./vaultSync.cjs');
    const syncRes = await syncToVault();
    if (syncRes.success && fs.existsSync(syncRes.memoryDir)) {
      logPass('Markdown Vault Sync', `Vault synced successfully to ${syncRes.memoryDir}.`);
    } else {
      logFail('Markdown Vault Sync', syncRes.error || 'Vault directory not found after sync.');
    }
  } catch (err) {
    logFail('Markdown Vault Sync', err.message);
  }

  // 9. MinerU Layout Normalizer Test
  try {
    const { normalizeDocumentToMarkdown } = require('./mineruNormalizer.cjs');
    const sampleText = 'Date   Amount\n01/01/2026   $100.00\n\nWORK EXPERIENCE\nSenior Writer';
    const result = normalizeDocumentToMarkdown(sampleText);
    if (result.includes('| Date | Amount |') && result.includes('## Work Experience')) {
      logPass('MinerU Document Normalizer', 'Layout normalization and GFM table conversion verified.');
    } else {
      logFail('MinerU Document Normalizer', 'Failed to normalize tables or headings.');
    }
  } catch (err) {
    logFail('MinerU Document Normalizer', err.message);
  }

  // 10. Store Data Store Integrity Check
  try {
    const store = require('./store.cjs');
    const d = store.load();
    if (Array.isArray(d.chats) && Array.isArray(d.memories) && Array.isArray(d.learnedKnowledge) && Array.isArray(d.lessons)) {
      logPass('Data Store Integrity', `Store file loaded (${d.chats.length} chats, ${d.memories.length} memories, ${d.learnedKnowledge.length} knowledge entries, ${d.lessons.length} lessons).`);
    } else {
      logFail('Data Store Integrity', 'Store fields missing or corrupted.');
    }
  } catch (err) {
    logFail('Data Store Integrity', err.message);
  }

  console.log('\n=== DIAGNOSTIC SUMMARY ===');
  console.log(`Passed: ${report.testsPassed} | Failed: ${report.testsFailed} | Warnings: ${report.warnings}\n`);

  if (report.issues.length > 0) {
    console.log('🚨 ISSUES / BUGS CALLED OUT:');
    report.issues.forEach((iss, idx) => {
      console.log(`${idx + 1}. [${iss.criticality}] ${iss.name}: ${iss.error}`);
    });
  } else {
    console.log('✨ All self-diagnostic tests passed cleanly with no critical bugs!');
  }

  return report;
}

if (require.main === module) {
  runSelfDiagnostics().catch(err => console.error('Self-diagnostic error:', err));
}

module.exports = { runSelfDiagnostics };
