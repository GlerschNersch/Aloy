/**
 * Needle Fast-Intent Engine (Shared Edge / Local Classifier)
 * Inspired by cactus-compute / Needle 14MB Foundation Model.
 * 
 * Provides sub-5ms zero-latency intent classification for common
 * smart home, media playback, and hardware commands before routing
 * to heavy LLMs.
 */

class NeedleIntentEngine {
  /**
   * Classifies user input text into actionable structured intent.
   * @param {string} input 
   * @returns {{ handledLocally: boolean, intent: string, action?: string, target?: string, confidence: number, payload?: any }}
   */
  static classify(input) {
    if (!input || typeof input !== 'string') {
      return { handledLocally: false, intent: 'UNKNOWN', confidence: 0 };
    }

    const text = input.trim().toLowerCase();

    // 1. Navigation intents
    if (/^(open|go to|show|view)\s+(hermes|brief|briefing)/i.test(text)) {
      return { handledLocally: true, intent: 'NAVIGATE', target: 'hermes', confidence: 0.99 };
    }
    if (/^(open|go to|show|view)\s+(athena|research|dossier)/i.test(text)) {
      return { handledLocally: true, intent: 'NAVIGATE', target: 'athena', confidence: 0.99 };
    }
    if (/^(open|go to|show|view)\s+(apollo|memory|wiki)/i.test(text)) {
      return { handledLocally: true, intent: 'NAVIGATE', target: 'apollo', confidence: 0.99 };
    }
    if (/^(open|go to|show|view)\s+(docs|documentation)/i.test(text)) {
      return { handledLocally: true, intent: 'NAVIGATE', target: 'docs', confidence: 0.99 };
    }

    // 2. Media Quick Controls
    if (/^(pause|stop|resume|unpause)\s*(media|video|playback|movie|tv)?$/i.test(text)) {
      const isPause = /pause|stop/i.test(text);
      return { handledLocally: true, intent: 'MEDIA_CONTROL', action: isPause ? 'pause' : 'resume', confidence: 0.98 };
    }
    const playMatch = text.match(/^(?:play|cast|watch)\s+(.+?)(?:\s+(?:on|to)\s+(lenny|bazzite|roku|living room))?$/i);
    if (playMatch) {
      const mediaTitle = playMatch[1].trim();
      const targetDevice = playMatch[2] ? playMatch[2].trim() : 'default';
      return {
        handledLocally: true,
        intent: 'MEDIA_PLAY',
        action: 'play',
        target: targetDevice,
        payload: { title: mediaTitle },
        confidence: 0.95
      };
    }

    // 3. Smart Home Toggles
    const lightMatch = text.match(/^(?:turn\s+(on|off)|toggle)\s+(?:the\s+)?(.+?)\s*(?:light|lights)?$/i);
    if (lightMatch && !text.includes('tv') && !text.includes('pc')) {
      return {
        handledLocally: true,
        intent: 'SMART_HOME_LIGHT',
        action: lightMatch[1] ? lightMatch[1].toLowerCase() : 'toggle',
        target: lightMatch[2].trim(),
        confidence: 0.92
      };
    }

    // 4. Default: complex reasoning pass through to full LLM
    return {
      handledLocally: false,
      intent: 'DEEP_REASONING_LLM',
      confidence: 0.5
    };
  }
}

module.exports = {
  NeedleIntentEngine
};
