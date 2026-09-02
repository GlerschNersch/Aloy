// Vision Tools for Aloy (Option 2 MVP)
// Real Claude vision integration

const fs = require('fs');
const path = require('path');
const https = require('https');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function callClaudeVision(imageBase64, prompt) {
  const payload = JSON.stringify({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: imageBase64
          }
        }
      ]
    }]
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.content?.[0]?.text || '';
          // Try to extract JSON from the response
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            resolve({ raw: text });
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function captureAndDescribe(bizhawkScreenshotTool) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not found in environment');
  }

  // 1. Take screenshot
  await bizhawkScreenshotTool();
  
  const screenshotPath = path.join(__dirname, '..', 'bizhawk_screenshot.png');
  const imageBase64 = fs.readFileSync(screenshotPath).toString('base64');
  
  const prompt = `You are analyzing a Super Mario Bros. 2 (SNES) screenshot.
Return ONLY valid JSON with these exact fields:
{
  "player_character": "Peach" | "Mario" | "Luigi" | "Toad",
  "player_position": "left" | "center" | "right",
  "visible_platforms": ["string"],
  "enemies": ["string"],
  "items": ["string"],
  "current_action_suggestion": "short string"
}`;

  const analysis = await callClaudeVision(imageBase64, prompt);

  return {
    screenshot: imageBase64,
    analysis
  };
}

module.exports = { captureAndDescribe };