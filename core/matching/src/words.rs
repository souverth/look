//! Word matching for text the user wrote themselves: notes, tasks.
//!
//! Fuzzy subsequence scoring suits names (`gch` finds Google Chrome) but turns
//! prose into noise, since almost any short query is a subsequence of a long
//! note. Here every word typed has to appear, in any order, so `milk buy`
//! finds "Buy milk" and `bk` finds nothing.

use crate::normalize_for_search;

pub const EXACT_SCORE: i64 = 2_000;
pub const PREFIX_SCORE: i64 = 1_500;
pub const WORDS_SCORE: i64 = 1_000;
/// Added when the query also appears as one run, so "buy milk" ranks a note
/// saying exactly that over one that mentions both words apart.
pub const PHRASE_BONUS: i64 = 100;

/// Scores `text` against `query`, folding case and diacritics on both sides.
/// `None` when a word of the query is missing, or the query is blank.
pub fn text_match_score(query: &str, text: &str) -> Option<i64> {
    let query = normalize_for_search(query.trim());
    if query.is_empty() {
        return None;
    }
    text_match_score_normalized(&query, &normalize_for_search(text))
}

/// [`text_match_score`] for a query and text already passed through
/// [`normalize_for_search`], for callers scoring one query against many fields.
pub fn text_match_score_normalized(query: &str, text: &str) -> Option<i64> {
    let text = text.trim();
    if query.is_empty() || text.is_empty() {
        return None;
    }
    if text == query {
        return Some(EXACT_SCORE);
    }
    if text.starts_with(query) {
        return Some(PREFIX_SCORE);
    }
    if !query.split_whitespace().all(|word| text.contains(word)) {
        return None;
    }
    let phrase = if text.contains(query) {
        PHRASE_BONUS
    } else {
        0
    };
    Some(WORDS_SCORE + phrase)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_beats_prefix_beats_words() {
        let exact = text_match_score("buy milk", "Buy milk").unwrap();
        let prefix = text_match_score("buy", "Buy milk").unwrap();
        let words = text_match_score("milk", "Buy milk").unwrap();
        assert!(exact > prefix && prefix > words);
    }

    #[test]
    fn every_word_must_appear_in_any_order() {
        assert!(text_match_score("milk buy", "Buy some milk").is_some());
        assert!(text_match_score("milk bread", "Buy some milk").is_none());
    }

    #[test]
    fn phrase_ranks_above_scattered_words() {
        let phrase = text_match_score("some milk", "buy some milk").unwrap();
        let scattered = text_match_score("milk buy", "buy some milk").unwrap();
        assert!(phrase > scattered);
    }

    #[test]
    fn subsequences_are_not_matches() {
        assert!(text_match_score("bk", "Buy milk").is_none());
    }

    #[test]
    fn diacritics_and_case_fold() {
        assert!(text_match_score("hop nhom", "Họp nhóm thứ 2").is_some());
        assert!(text_match_score("DIEN", "điện thoại").is_some());
    }

    #[test]
    fn blank_query_or_text_never_matches() {
        assert!(text_match_score("  ", "anything").is_none());
        assert!(text_match_score("a", "   ").is_none());
    }
}
