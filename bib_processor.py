"""解析 / 改写 .bib 文件中的 journal 字段。"""
from __future__ import annotations

import bibtexparser

from abbreviator import abbreviate_journal

STATUS_ABBREVIATED = "已缩写"
STATUS_UNCHANGED = "未变化"
STATUS_NO_JOURNAL = "无 journal 字段（跳过）"


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "gbk", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="replace")


def process_bib(file_bytes: bytes) -> tuple[str, list[tuple[str, str, str, str]]]:
    """将 bib 中每个 entry 的 journal 字段替换为 ISO 4 缩写。

    返回 (新 bib 文本, 报告行)，报告行为：
        (entry_key, 原期刊名, 缩写, 状态)
    无 journal 字段的条目（如 @book、@inproceedings）不改动并在报告中标注。
    """
    text = _decode(file_bytes)
    library = bibtexparser.parse_string(text)
    if not library.entries:
        raise ValueError("未解析到任何 bib 条目，请检查文件格式是否正确。")

    report: list[tuple[str, str, str, str]] = []
    for entry in library.entries:
        field = entry.fields_dict.get("journal")
        if field is None:
            report.append((entry.key, "", "", STATUS_NO_JOURNAL))
            continue
        original = field.value
        abbreviated = abbreviate_journal(original)
        entry["journal"] = abbreviated
        status = STATUS_ABBREVIATED if abbreviated != original else STATUS_UNCHANGED
        report.append((entry.key, original, abbreviated, status))

    return bibtexparser.write_string(library), report
