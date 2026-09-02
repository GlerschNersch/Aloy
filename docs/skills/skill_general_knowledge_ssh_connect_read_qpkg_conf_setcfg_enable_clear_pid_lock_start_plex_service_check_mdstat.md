---
name: Aloy Skill - General Knowledge
category: General Knowledge
synthesized_at: 2026-08-05T01:14:56.310Z
last_seen_at: 2026-08-05T01:14:56.310Z
occurrences: 5
---

# General Knowledge Workflow

## 1. Intent & Trigger
- **Category**: `General Knowledge`
- **Example Prompt**: "How do I fix Plex stuck on QNAP NAS or check degraded RAID 5 status?"
- **Pattern Confidence**: 5 verified repetitions in user interaction logs.

## 2. Deterministic Tool Execution Pipeline
Execute the following sequence in exact order to satisfy requests in this domain:

1. **`ssh_connect`**
   - *Purpose*: Query intermediate data for category `General Knowledge`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.
2. **`read_qpkg_conf`**
   - *Purpose*: Query intermediate data for category `General Knowledge`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.
3. **`setcfg_enable`**
   - *Purpose*: Query intermediate data for category `General Knowledge`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.
4. **`clear_pid_lock`**
   - *Purpose*: Query intermediate data for category `General Knowledge`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.
5. **`start_plex_service`**
   - *Purpose*: Query intermediate data for category `General Knowledge`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.
6. **`check_mdstat`**
   - *Purpose*: Query intermediate data for category `General Knowledge`
   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.

## 3. Cognitive Guardrails & Error Recovery
- **Read-Only Scope**: This synthesized skill contains only non-destructive read actions.
- **Self-Correction**: If any step in the pipeline returns a `status: "error"` envelope or exception, review the `[SYSTEM HINT]` and attempt the next logical alternative.
- **Safety**: Do not substitute write/modification tools without explicit human confirmation.
