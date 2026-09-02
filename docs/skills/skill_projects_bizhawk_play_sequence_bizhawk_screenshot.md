---
name: Aloy Skill - Projects
category: Projects
synthesized_at: 2026-08-10T16:47:14.672Z
last_seen_at: 2026-08-10T19:43:13.578Z
occurrences: 11
---

# Projects Workflow

## 1. Intent & Trigger
- **Category**: `Projects`
- **Example Prompt**: "Call bizhawk_play_sequence with buttons {"Right": true} and frames 15, then take a screenshot with bizhawk_screenshot."
- **Pattern Confidence**: 11 verified repetitions in user interaction logs.

## 2. Deterministic Tool Execution Pipeline
Execute the following sequence in exact order to satisfy requests in this domain:

1. **`bizhawk_play_sequence`**
   - *Purpose*: Query intermediate data for category `Projects`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.
2. **`bizhawk_screenshot`**
   - *Purpose*: Query intermediate data for category `Projects`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.

## 3. Cognitive Guardrails & Error Recovery
- **Read-Only Scope**: This synthesized skill contains only non-destructive read actions.
- **Self-Correction**: If any step in the pipeline returns a `status: "error"` envelope or exception, review the `[SYSTEM HINT]` and attempt the next logical alternative.
- **Safety**: Do not substitute write/modification tools without explicit human confirmation.
