# BizHawk / SMB2 memory calibration — 2026-08-10

Real findings from actually diffing WRAM dumps (not guessed), superseding the
address table in `teaching_aloy_smb2_snes.md` where they conflict.

## Verified
- **0x089B (WRAM)** — increases monotonically and accelerates under sustained
  rightward movement (confirmed: 0 -> 37 -> 101 across two 60-frame Right
  holds). Real forward-progress signal. Likely a mirrored per-sprite
  scroll/position field rather than the single canonical player-X variable —
  it appears identically at 9 addresses ~8-16 bytes apart (0x89B, 0x8AB,
  0x8BB, 0x8C3, 0x8DB, 0x8E3, 0x8F3, 0x903, 0x913), consistent with an
  OAM-prep sprite table. Good enough as a "am I making progress" proxy;
  not confirmed as the canonical position variable.
- Confirm/select button in the SMAS carousel + file-select + character-select
  menus is **Start**, not A — A does nothing on those screens. (A does work
  for confirming individual choices deeper in some menus.)
- Sub-Space red doors need **Up** while stationary, not while moving right
  (per user).

## Explicitly NOT verified — do not trust as ground truth
- `0x00ED`/`0x00EE` (world/stage), `0x00F4`/`0x00F5` (health), `0x009C-0x009F`
  (position high/low bytes), `0x04C0`/`0x04E0`/`0x060C`/`0x0625` — all from
  the original doc, never checked against real memory. The position bytes in
  particular stayed at their spawn value (x_pos=1) for an entire test where
  Peach visibly walked across several screens, so that pairing is wrong.
  `bizhawk_read_game_state` (src/services/tools.js) still reads these as a
  best-effort/placeholder — treat its output as unreliable until redone with
  the same before/after-diff method used for 0x089B.

## How the diff was done (repeatable)
`bizhawk_dump_memory` (address, length<=4096, domain) three times: baseline,
after 60 frames of Right, after another 60 frames of Right. Kept only bytes
(or 16-bit LE pairs) that changed monotonically in the same direction both
times — filters out sound/animation/RNG noise, which is most of what a raw
single before/after diff turns up (188 raw diffs vs. ~14 monotonic
candidates in this run). Script pattern is in this session's transcript;
worth turning into a reusable tool if this gets revisited.

## Current autoplay loop status (server/bizhawkAutoPlay.cjs)
Real, running loop (start/stop/status via bizhawk_autoplay_start /
bizhawk_autoplay_stop / get_bizhawk_autoplay_status), not per-frame LLM
calls. Verified it genuinely runs, checkpoints, detects lack of progress,
and reloads. NOT yet able to clear the very first obstacle in World 1-1 (a
tall ledge near the starting Sub-Space door) — the "hold right, jump
rhythmically, try Up then jump when stuck" heuristic isn't smart enough for
a vertical climb. Next real step: either (a) detect stuck-against-a-wall
specifically (progress genuinely flat, not just low, over several frames)
and try holding a longer jump / repeated jump-into-wall to climb, or (b)
build actual hazard-memory like the abandoned earlier session attempted —
record the (world, stage, progress-value) where each stuck/reload happened,
and pre-emptively jump earlier on the next attempt at that spot.
