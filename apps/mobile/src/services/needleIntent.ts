/**
 * Needle On-Device Fast Intent Classifier for Aloy Mobile
 * Inspired by cactus-compute / Needle 14MB Foundation Model.
 * 
 * Executes directly on the mobile CPU/JS engine in <2ms with zero network hops.
 */

export interface NeedleClassification {
  handledLocally: boolean;
  intent: string;
  action?: string;
  target?: string;
  confidence: number;
  payload?: any;
}

export class MobileNeedleEngine {
  static classify(input: string): NeedleClassification {
    if (!input || typeof input !== 'string') {
      return { handledLocally: false, intent: 'UNKNOWN', confidence: 0 };
    }

    const text = input.trim().toLowerCase();

    // 1. Navigation shortcuts
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

    // 2. Instant Media Controls
    if (/^(pause|stop|resume|unpause)\s*(media|video|playback|movie|tv)?$/i.test(text)) {
      const isPause = /pause|stop/i.test(text);
      return { handledLocally: true, intent: 'MEDIA_CONTROL', action: isPause ? 'pause' : 'resume', confidence: 0.98 };
    }

    const playMatch = text.match(/^(?:play|cast|watch)\s+(.+?)(?:\s+(?:on|to)\s+(lenny|bazzite|roku|living room))?$/i);
    if (playMatch) {
      return {
        handledLocally: true,
        intent: 'MEDIA_PLAY',
        action: 'play',
        target: playMatch[2] ? playMatch[2].trim() : 'default',
        payload: { title: playMatch[1].trim() },
        confidence: 0.95
      };
    }

    // 3. Fallback to Full Network LLM
    return {
      handledLocally: false,
      intent: 'DEEP_REASONING_LLM',
      confidence: 0.5
    };
  }
}
