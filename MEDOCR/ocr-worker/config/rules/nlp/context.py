import os, json, re

BASE = os.path.dirname(__file__)
RULES_PATH = os.path.join(BASE, "nlp_rules.json")

# --- Load rules with safe defaults ---
try:
    with open(RULES_PATH, "r") as f:
        RULES = json.load(f)
except Exception:
    RULES = {
        "proximityWindow": 8,
        "subjectHints": ["patient", "pt", "he", "she", "they", "i"],
        "thirdPartyHints": [
            "father", "mother", "spouse", "wife", "husband", "partner",
            "son", "daughter", "child", "kids", "brother", "sister",
            "coworker", "roommate", "grandfather", "grandmother", "grandparent"
        ],
        "temporalCues": {
            "history": ["hx of", "history of", "previously", "prior", "years ago", "past medical history", "pmh"],
            "resolved": ["resolved", "no longer", "discontinued", "stopped", "quit", "off cpap"]
        }
    }

_WORD_RE = re.compile(r"^\w+$", re.UNICODE)


def _tokenize(text: str):
    """Return (tokens, lowered, word_indexes).
    tokens: list of all tokens including punctuation (kept for pretty context)
    lowered: lowercase tokens
    word_indexes: indexes in `tokens` that are alphanumeric words
    """
    tokens = re.findall(r"\w+|\W+", text or "")
    lowered = [t.lower() for t in tokens]
    word_indexes = [i for i, t in enumerate(tokens) if _WORD_RE.match(t)]
    return tokens, lowered, word_indexes


def windowed_matches(text: str, term: str, window: int | None = None):
    """
    Yield dicts: {"match": str, "start": int, "end": int, "context": str}
    - case-insensitive
    - supports multi-word terms (e.g., "sleep apnea")
    - `window` is counted in WORDS on each side; context includes punctuation between.
    """
    if not term:
        return

    win = RULES.get("proximityWindow", 8) if window is None else window
    tokens, lowered, widx = _tokenize(text)

    # Prepare the search sequence (words only)
    term_words = re.findall(r"\w+", term.lower())
    if not term_words:
        return

    words_only = [lowered[i] for i in widx]
    tlen = len(term_words)

    for j in range(0, max(0, len(words_only) - tlen + 1)):
        if words_only[j:j + tlen] == term_words:
            # map back to token indexes
            start_tok = widx[j]
            end_tok = widx[j + tlen - 1]

            # compute word-window bounds, then convert to token-window
            left_word = max(0, j - win)
            right_word = min(len(words_only) - 1, j + tlen - 1 + win)
            left_tok = widx[left_word]
            right_tok = widx[right_word]

            # include punctuation lying between left_tok..right_tok
            context = "".join(tokens[left_tok:right_tok + 1])
            match_text = " ".join(tokens[start_tok:end_tok + 1]).strip()
            yield {"match": match_text, "start": start_tok, "end": end_tok + 1, "context": context}


def is_third_party(sentence: str) -> bool:
    s = (sentence or "").lower()
    return any(tp in s for tp in RULES.get("thirdPartyHints", []))


def temporal_tag(sentence: str) -> str:
    s = (sentence or "").lower()
    for cue in RULES.get("temporalCues", {}).get("resolved", []):
        if cue in s:
            return "resolved"
    for cue in RULES.get("temporalCues", {}).get("history", []):
        if cue in s:
            return "history"
    return "current"