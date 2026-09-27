"""Gradio 界面入口：python app.py 后浏览器打开 http://127.0.0.1:7860"""
from __future__ import annotations

import tempfile
from pathlib import Path

import gradio as gr

from abbreviator import abbreviate_many
from bib_processor import process_bib

BIB_HEADERS = ["条目 Key", "原期刊名", "ISO 4 缩写", "状态"]
MANUAL_HEADERS = ["期刊全名", "ISO 4 缩写"]


def convert_bib(bib_path):
    if not bib_path:
        gr.Warning("请先上传 .bib 文件")
        return [], None
    try:
        new_text, report = process_bib(Path(bib_path).read_bytes())
    except Exception as exc:
        raise gr.Error(f"bib 处理失败：{exc}")
    out_path = Path(tempfile.mkdtemp()) / f"{Path(bib_path).stem}_abbreviated.bib"
    out_path.write_text(new_text, encoding="utf-8")
    return [list(row) for row in report], str(out_path)


def add_abbreviations(text, rows):
    names = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if not names:
        gr.Warning("请输入至少一个期刊全名（每行一个）")
        return rows, rows, ""
    rows = rows + [[orig, abbr] for orig, abbr in abbreviate_many(names)]
    return rows, rows, ""


def clear_rows():
    return [], [], None


def export_txt(rows):
    if not rows:
        gr.Warning("列表为空，无内容可导出")
        return None
    out_path = Path(tempfile.mkdtemp()) / "journal_abbreviations.txt"
    out_path.write_text(
        "".join(f"{orig}\t{abbr}\n" for orig, abbr in rows), encoding="utf-8"
    )
    return str(out_path)


with gr.Blocks(title="期刊名缩写工具（ISO 4 / LTWA）") as demo:
    gr.Markdown(
        "# 期刊名缩写工具（ISO 4 / LTWA）\n"
        "按 ISO 4 规则（基于 LTWA 词表）将期刊全名缩写，用于 SCI 投稿参考文献格式。"
        "全程本地运行，不联网、不上传任何数据。"
    )
    with gr.Tabs():
        with gr.Tab("Bib 文件转换"):
            bib_input = gr.File(
                label="上传 .bib 文件", file_types=[".bib"], type="filepath"
            )
            bib_btn = gr.Button("开始转换", variant="primary")
            bib_table = gr.Dataframe(
                headers=BIB_HEADERS, label="处理报告", interactive=False
            )
            bib_out = gr.File(label="下载转换后的 .bib")
            bib_btn.click(
                convert_bib, inputs=bib_input, outputs=[bib_table, bib_out]
            )

        with gr.Tab("手动输入"):
            name_input = gr.Textbox(
                lines=6,
                label="期刊全名（每行一个，可一次粘贴多个）",
                placeholder="Journal of the American Chemical Society\nNature Communications",
            )
            with gr.Row():
                add_btn = gr.Button("生成缩写", variant="primary")
                clear_btn = gr.Button("清空列表")
                export_btn = gr.Button("导出为 txt")
            state = gr.State([])
            manual_table = gr.Dataframe(
                headers=MANUAL_HEADERS,
                label="缩写结果（多次生成会追加到下方）",
                interactive=False,
            )
            txt_out = gr.File(label="下载 txt（原名⇥缩写，每行一条）")
            add_btn.click(
                add_abbreviations,
                inputs=[name_input, state],
                outputs=[manual_table, state, name_input],
            )
            clear_btn.click(
                clear_rows, outputs=[manual_table, state, txt_out]
            )
            export_btn.click(export_txt, inputs=state, outputs=txt_out)

if __name__ == "__main__":
    demo.launch(inbrowser=True)
