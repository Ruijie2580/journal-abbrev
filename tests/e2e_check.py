"""一次性 e2e 验证脚本：通过 gradio_client 真实调用两个 Tab 的全部功能。"""
from pathlib import Path

from gradio_client import Client, handle_file

client = Client("http://127.0.0.1:7860/")

print("=== Tab 1: Bib 文件转换 ===")
table, out_file = client.predict(
    handle_file("tests/sample.bib"), api_name="/convert_bib"
)
rows = table["data"]
print(f"报告行数: {len(rows)}")
for r in rows:
    print(" ", r)
assert len(rows) == 6, "应有 6 行报告"
assert rows[0][1] == "Journal of the American Chemical Society"
assert rows[0][2] == "J. Am. Chem. Soc."
assert rows[0][3] == "已缩写"
assert rows[3][3] == "无 journal 字段（跳过）"
assert rows[4][3] == "无 journal 字段（跳过）"
assert rows[5][3] == "无 journal 字段（跳过）"

bib_text = Path(out_file).read_text(encoding="utf-8")
assert "journal = {J. Am. Chem. Soc.}" in bib_text
assert "journal = {Nat. Commun.}" in bib_text
assert "journal = {Phys. Rev. Lett.}" in bib_text
assert "publisher = {Springer}" in bib_text
assert "booktitle = {Proceedings of the AAAI Conference on Artificial Intelligence}" in bib_text
print("输出 bib 内容校验通过；下载文件:", Path(out_file).name)

print("\n=== Tab 2: 手动输入（追加 + 导出 + 清空）===")
table, _ = client.predict(
    "Journal of the American Chemical Society\nNature Communications",
    api_name="/add_abbreviations",
)
assert table["data"] == [
    ["Journal of the American Chemical Society", "J. Am. Chem. Soc."],
    ["Nature Communications", "Nat. Commun."],
], table["data"]
print("第一批 2 行正确")

table, _ = client.predict("Physical Review Letters", api_name="/add_abbreviations")
assert len(table["data"]) == 3, "追加后应有 3 行"
assert table["data"][2] == ["Physical Review Letters", "Phys. Rev. Lett."]
print("第二批追加成功，共 3 行")

txt_file = client.predict(api_name="/export_txt")
txt = Path(txt_file).read_text(encoding="utf-8")
print("导出 txt 内容:")
print(txt)
assert "Journal of the American Chemical Society\tJ. Am. Chem. Soc.\n" in txt
assert "Nature Communications\tNat. Commun.\n" in txt
assert "Physical Review Letters\tPhys. Rev. Lett.\n" in txt

table, _ = client.predict(api_name="/clear_rows")
assert table["data"] in ([], [[]]) or not table["data"], table["data"]
print("清空列表成功")

print("\n全部 e2e 断言通过！")
