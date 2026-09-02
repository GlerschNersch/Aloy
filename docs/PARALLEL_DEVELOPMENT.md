# Parallel Development: Option 2 + Option 5

## Current State (MVP Skeletons Created)

### Option 5 — God View Dashboard
- Location: `aloy-dashboard/`
- Files:
  - `server.js` — Express server on port 3456
  - `public/index.html` — Basic live dashboard (screenshot + status + learnings + hazard)
- Run with: `node aloy-dashboard/server.js`
- Access at: http://localhost:3456

### Option 2 — Vision Tools
- Location: `vision/`
- Files:
  - `vision-tools.cjs` — Skeleton that captures screenshot and returns structured analysis
- Currently uses a fake response. Replace the fake block with real Claude/Gemini vision call.

## How They Will Connect

1. The dashboard will eventually call vision tools when "Vision Mode" is enabled.
2. Vision analysis results will be displayed in a new panel in the dashboard.
3. Both systems share the same `bizhawk_screenshot.png` file.

## Next Real Steps

- Replace fake vision response with actual API call (Claude 3.5 or Gemini).
- Add a `/api/vision` endpoint in the dashboard server that triggers vision analysis.
- Show vision output (structured JSON + confidence) in the web UI.

This is the foundation. Both pieces are now running in parallel.