"""
Exports Aloy's chat history (~/.aloy-server/store.json)
into a JSONL instruction-tuning dataset for the gemma4:12b QLoRA fine-tune.

This is deliberately conservative. A first pass over the raw data found that
~55% of Claude-escalation "corrections" are actively wrong to train on:
Claude's escalation fallback is a stateless, tool-less API call, so its
answers routinely (a) claim the "I'm Claude, made by Anthropic" identity
instead of Aloy's, or (b) deny capabilities ("I can't control your lights",
"I don't have access to your repository") that Aloy actually has via its
real tool calls. Both failure modes are filtered out below rather than
trusted blindly. See BAD_CONTENT_PATTERNS and EXCLUDED_CHAT_IDS.

Run: python export_dataset.py > aloy_sft.jsonl
"""
import json
import os
import sys

STORE_PATH = os.path.expanduser("~/.aloy-server/store.json")

# Chats known (from project history, not detectable generically) to capture
# a real bug's buggy transcript rather than a stylistically-good exchange.
# "turn on the kitchen light" (chat-1785783734764): the local model reported
# false success (entity_id mismatch bug, fixed 2026-08-03) and the Claude
# escalation fallback then wrongly claimed no smart-home access at all.
# Neither answer is safe to imitate.
EXCLUDED_CHAT_IDS = {
    "chat-1785783734764",
}

# Manually reviewed drops: (chat_id, normalized user text) pairs pulled after
# eyeballing the exported set. "Is that everything on the calendar?" paired
# with a *tomorrow's* schedule answer inside the long, multi-day "Look at my
# schedule for today" chat — looks like a today/tomorrow hand-off mismatch
# from that chat's drift, not confidently a correct exchange. Not something
# a generic content filter can safely detect; excluded by hand.
EXCLUDED_TURNS = {
    ("chat-1785445406045", "isthateverythingonthecalendar"),
}

# Assistant answers matching these are unsafe to train on regardless of
# source chat: identity leakage (Claude's fallback describing itself instead
# of Aloy) or false capability denial (Claude's fallback has no tools, so it
# denies things Aloy can actually do).
BAD_CONTENT_PATTERNS = [
    r"\bI'?m Claude\b",
    r"\bmade by Anthropic\b",
    r"\bI am Claude\b",
    r"\bI don'?t have (any )?(access|connection) to your\b",
    r"\bI'?m not able to control\b",
    r"\bI can'?t (actually )?(run|execute|access) (anything|your)\b",
    r"\bI don'?t have introspective access\b",
]
BAD_CONTENT_RE = re.compile("|".join(BAD_CONTENT_PATTERNS), re.IGNORECASE)

CORRECTION_LABEL_RE = re.compile(
    r"^_(?:Checked with Claude|Claude proofread this against your original document)[^_]*_\s*",
    re.IGNORECASE,
)

# Long, wide-ranging test/probe chats get sampled rather than fully included,
# so one chat can't dominate a dataset this small, and so off-topic tangents
# (e.g. a self-identity Q&A tangent inside a schedule-lookup chat) don't leak
# in just because they share a chat id with good turns.
MAX_TURNS_PER_CHAT = 3
TOPIC_KEYWORDS_FOR_LONG_CHATS = ("schedule", "calendar", "event", "workout")
# Only this specific chat is known (from manual review) to wander into an
# off-topic self-identity tangent ("tell me your specs", "how many
# parameters") partway through — NOT a blanket property of long chats. The
# mortgage-document chat below is also long but stays on-topic throughout,
# so it must not be caught by the same restriction.
WANDERING_CHAT_IDS = {"chat-1785445406045"}

# Bare "what's my schedule for tomorrow"-style lookups regenerate the same
# underlying calendar data worded slightly differently each time — they pass
# text-dedup as "different" but are redundant training signal. Cap how many
# of this one narrow intent can occupy an already-small dataset.
BARE_SCHEDULE_LOOKUP_RE = re.compile(
    r"^(what'?s|whats|what is|give me|look at) (my )?(full |complete )?schedule (for |for tomorrow)?",
    re.IGNORECASE,
)
MAX_BARE_SCHEDULE_LOOKUPS = 2

TOOL_TEST_TITLE_MARKERS = (
    "using your filesystem tool",
    "using your fetch tool",
    "using your git tool",
    "can you go to https://example",
)

SYSTEM_PROMPT = (
    "You are Aloy, a local personal AI assistant. "
    "Style: concise, direct, highly technical, clean code, dark UI aesthetics. "
    "Always address requests directly with production-ready code and optimal architecture. "
    "You run entirely locally and have real tool access (smart home control, filesystem, "
    "calendar, finances) — never claim to be Claude/Anthropic or deny capabilities you have."
)


def normalize_for_dedup(text):
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())[:60]


def clean_assistant_content(raw):
    return CORRECTION_LABEL_RE.sub("", raw or "").strip()


def is_safe(content):
    return bool(content) and not BAD_CONTENT_RE.search(content)


def extract_candidates(chat):
    """Yield (user_text, assistant_text) pairs, preferring an
    answeredViaClaude correction over the original answer when both exist
    for the same user turn."""
    msgs = chat.get("messages", [])
    i = 0
    while i < len(msgs):
        m = msgs[i]
        if m.get("role") != "user":
            i += 1
            continue
        user_text = (m.get("content") or "").strip()
        # Gather the run of assistant messages that follow, up to the next
        # user message — the last answeredViaClaude one wins if present,
        # else the last plain assistant message with real content.
        j = i + 1
        best_plain, best_corrected = None, None
        while j < len(msgs) and msgs[j].get("role") == "assistant":
            content = (msgs[j].get("content") or "").strip()
            if content:
                if msgs[j].get("answeredViaClaude"):
                    best_corrected = content
                else:
                    best_plain = content
            j += 1
        target = clean_assistant_content(best_corrected) if best_corrected else best_plain
        if user_text and target:
            yield user_text, target
        i = j


def build_dataset():
    with open(STORE_PATH, encoding="utf-8") as f:
        store = json.load(f)

    examples = []
    seen_user_keys = set()
    seen_assistant_keys = set()
    bare_schedule_lookups_taken = 0

    for chat in store.get("chats", []):
        chat_id = chat.get("id")
        if chat_id in EXCLUDED_CHAT_IDS:
            continue
        title = (chat.get("title") or "").lower()
        if any(marker in title for marker in TOOL_TEST_TITLE_MARKERS):
            continue
        if any(m.get("isDailyReport") for m in chat.get("messages", [])):
            continue

        is_wandering_chat = chat_id in WANDERING_CHAT_IDS
        taken_this_chat = 0

        for user_text, assistant_text in extract_candidates(chat):
            if taken_this_chat >= MAX_TURNS_PER_CHAT:
                break
            if len(user_text) < 8 or len(assistant_text) < 20:
                continue  # too trivial to carry real style signal
            if is_wandering_chat and not any(
                kw in user_text.lower() for kw in TOPIC_KEYWORDS_FOR_LONG_CHATS
            ):
                continue  # skip the off-topic self-identity tangent in this chat
            if not is_safe(assistant_text):
                continue
            if BARE_SCHEDULE_LOOKUP_RE.match(user_text.strip()):
                if bare_schedule_lookups_taken >= MAX_BARE_SCHEDULE_LOOKUPS:
                    continue
                bare_schedule_lookups_taken += 1

            user_key = normalize_for_dedup(user_text)
            if (chat_id, user_key) in EXCLUDED_TURNS:
                continue
            assistant_key = normalize_for_dedup(assistant_text)
            if user_key in seen_user_keys or assistant_key in seen_assistant_keys:
                continue
            seen_user_keys.add(user_key)
            seen_assistant_keys.add(assistant_key)
            taken_this_chat += 1

            examples.append(
                {
                    "conversations": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_text},
                        {"role": "assistant", "content": assistant_text},
                    ]
                }
            )

    return examples


if __name__ == "__main__":
    examples = build_dataset()
    out = sys.stdout if len(sys.argv) < 2 else open(sys.argv[1], "w", encoding="utf-8")
    for ex in examples:
        out.write(json.dumps(ex, ensure_ascii=False) + "\n")
    if out is not sys.stdout:
        out.close()
    print(f"Exported {len(examples)} examples", file=sys.stderr)
