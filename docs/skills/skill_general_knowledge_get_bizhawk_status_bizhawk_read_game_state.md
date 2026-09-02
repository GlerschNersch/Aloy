---
name: Aloy Skill - General Knowledge
category: General Knowledge
synthesized_at: 2026-08-10T17:25:16.349Z
last_seen_at: 2026-08-10T17:25:16.349Z
occurrences: 2
---

# General Knowledge Workflow

## 1. Intent & Trigger
- **Category**: `General Knowledge`
- **Example Prompt**: "How is the game going?"
- **Pattern Confidence**: 2 verified repetitions in user interaction logs.

## 2. Deterministic Tool Execution Pipeline
Execute the following sequence in exact order to satisfy requests in this domain:

1. **`get_bizhawk_status`**
   - *Purpose*: Query intermediate data for category `General Knowledge`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.
2. **`bizhawk_read_game_state`**
   - *Purpose*: Query intermediate data for category `General Knowledge`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.

## 3. Cognitive Guardrails & Error Recovery
- **Read-Only Scope**: This synthesized skill contains only non-destructive read actions.
- **Self-Correction**: If any step in the pipeline returns a `status: "error"` envelope or exception, review the `[SYSTEM HINT]` and attempt the next logical alternative.
- **Safety**: Do not substitute write/modification tools without explicit human confirmation.
