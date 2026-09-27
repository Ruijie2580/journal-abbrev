"""已知 ISO 4 缩写对照断言 + bib 处理流程测试。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from abbreviator import abbreviate_journal, abbreviate_many
from bib_processor import (
    STATUS_ABBREVIATED,
    STATUS_NO_JOURNAL,
    process_bib,
)

KNOWN_CASES = {
    "Journal of the American Chemical Society": "J. Am. Chem. Soc.",
    "Physical Review Letters": "Phys. Rev. Lett.",
    "Angewandte Chemie International Edition": "Angew. Chem. Int. Ed.",
    "Nature Communications": "Nat. Commun.",
}


def test_known_abbreviations():
    for full, abbr in KNOWN_CASES.items():
        assert abbreviate_journal(full) == abbr


def test_single_word_title_unchanged():
    assert abbreviate_journal("Nature") == "Nature"
    assert abbreviate_journal("Cell") == "Cell"


def test_strips_surrounding_whitespace():
    assert abbreviate_journal("  Nature Communications  ") == "Nat. Commun."


def test_empty_input_returns_empty():
    assert abbreviate_journal("") == ""
    assert abbreviate_journal("   ") == ""


def test_abbreviate_many_keeps_order():
    names = list(KNOWN_CASES)
    assert abbreviate_many(names) == [(n, KNOWN_CASES[n]) for n in names]


def test_process_bib_replaces_journal_fields():
    data = (Path(__file__).parent / "sample.bib").read_bytes()
    new_text, report = process_bib(data)

    assert "journal = {J. Am. Chem. Soc.}" in new_text
    assert "journal = {Nat. Commun.}" in new_text
    assert "journal = {Phys. Rev. Lett.}" in new_text

    # 无 journal 字段的条目保持原样
    assert "publisher = {Springer}" in new_text
    assert "booktitle = {Proceedings of the AAAI Conference on Artificial Intelligence}" in new_text

    by_key = {row[0]: row for row in report}
    assert len(report) == 6
    assert by_key["smith2020jacs"][1:] == (
        "Journal of the American Chemical Society",
        "J. Am. Chem. Soc.",
        STATUS_ABBREVIATED,
    )
    assert by_key["doe2018book"][3] == STATUS_NO_JOURNAL
    assert by_key["liu2022conf"][3] == STATUS_NO_JOURNAL
    assert by_key["nojournal2023"][3] == STATUS_NO_JOURNAL


def test_process_bib_rejects_non_bib_content():
    try:
        process_bib("this is not a bib file at all".encode("utf-8"))
    except ValueError:
        return
    raise AssertionError("应当抛出 ValueError")
