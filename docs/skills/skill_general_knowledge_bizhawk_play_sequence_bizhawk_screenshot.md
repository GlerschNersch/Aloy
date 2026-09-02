---
name: Aloy Skill - General Knowledge
category: General Knowledge
synthesized_at: 2026-08-10T16:49:29.375Z
last_seen_at: 2026-08-10T19:42:35.169Z
occurrences: 38
---

# General Knowledge Workflow

## 1. Intent & Trigger
- **Category**: `General Knowledge`
- **Example Prompt**: "Call bizhawk_play_sequence with buttons {"Start": true} and frames 10. Then take a screenshot with bizhawk_screenshot."
- **Pattern Confidence**: 38 verified repetitions in user interaction logs.

## 2. Deterministic Tool Execution Pipeline
Execute the following sequence in exact order to satisfy requests in this domain:

1. **`bizhawk_play_sequence`**
   - *Purpose*: Query intermediate data for category `General Knowledge`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.
2. **`bizhawk_screenshot`**
   - *Purpose*: Query intermediate data for category `General Knowledge`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.

## 3. Cognitive Guardrails & Error Recovery
- **Read-Only Scope**: This synthesized skill contains only non-destructive read actions.
- **Self-Correction**: If any step in the pipeline returns a `status: "error"` envelope or exception, review the `[SYSTEM HINT]` and attempt the next logical alternative.
- **Safety**: Do not substitute write/modification tools without explicit human confirmation.
