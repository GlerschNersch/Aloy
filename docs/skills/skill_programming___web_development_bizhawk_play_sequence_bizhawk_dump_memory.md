---
name: Aloy Skill - Programming & Web Development
category: Programming & Web Development
synthesized_at: 2026-08-10T17:15:47.916Z
last_seen_at: 2026-08-10T17:43:27.327Z
occurrences: 8
---

# Programming & Web Development Workflow

## 1. Intent & Trigger
- **Category**: `Programming & Web Development`
- **Example Prompt**: "Call bizhawk_play_sequence with buttons {"Right":true} and frames 60. Then call bizhawk_dump_memory with address 0, length 4096, domain WRAM."
- **Pattern Confidence**: 8 verified repetitions in user interaction logs.

## 2. Deterministic Tool Execution Pipeline
Execute the following sequence in exact order to satisfy requests in this domain:

1. **`bizhawk_play_sequence`**
   - *Purpose*: Query intermediate data for category `Programming & Web Development`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.
2. **`bizhawk_dump_memory`**
   - *Purpose*: Query intermediate data for category `Programming & Web Development`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.

## 3. Cognitive Guardrails & Error Recovery
- **Read-Only Scope**: This synthesized skill contains only non-destructive read actions.
- **Self-Correction**: If any step in the pipeline returns a `status: "error"` envelope or exception, review the `[SYSTEM HINT]` and attempt the next logical alternative.
- **Safety**: Do not substitute write/modification tools without explicit human confirmation.
