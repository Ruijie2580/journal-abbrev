"""核心：期刊全名 → ISO 4 缩写（基于 iso4 包内置的 LTWA 官方数据）。"""
from __future__ import annotations

import nltk


def _wordnet_available() -> bool:
    try:
        from nltk.corpus import wordnet

        wordnet.synsets("journal")
        return True
    except Exception:
        return False


def _ensure_wordnet() -> None:
    """确保 iso4 依赖的 NLTK wordnet 语料可用，缺失时尽早给出明确报错。"""
    if _wordnet_available():
        return
    nltk.download("wordnet", quiet=True)
    if not _wordnet_available():
        raise RuntimeError(
            "缺少 NLTK wordnet 语料库，iso4 缩写引擎无法工作。请执行：\n"
            "    python -m nltk.downloader wordnet\n"
            "或手动下载 wordnet.zip 放入 nltk_data/corpora/ 目录后重试。"
        )


_ensure_wordnet()

import iso4


def abbreviate_journal(name: str) -> str:
    """将期刊全名缩写为 ISO 4 形式。

    - 去首尾空格；定冠词、介词与大小写规则交给 iso4 按 ISO 4 处理。
    - 单词在 LTWA 中无规则时保留原词；整体异常时原样返回，绝不静默丢词。
    """
    cleaned = (name or "").strip()
    if not cleaned:
        return ""
    try:
        return iso4.abbreviate(cleaned)
    except Exception:
        return cleaned


def abbreviate_many(names: list[str]) -> list[tuple[str, str]]:
    """批量缩写，返回 [(原名, 缩写)]，顺序与输入一致。"""
    return [(n, abbreviate_journal(n)) for n in names]
