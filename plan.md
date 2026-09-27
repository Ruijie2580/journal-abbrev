# 期刊名缩写工具（ISO 4 / LTWA）最小可用版本 — 实施计划

## 目标

一个本地运行的小应用，解决 SCI 论文投稿时参考文献期刊名需按 **ISO 4**（基于 ISSN 的 *List of Title Word Abbreviations*, LTWA）缩写的问题：

1. 上传 `.bib` 文件 → 自动识别每条的 `journal` 字段 → 生成期刊名替换为缩写的新 `.bib` 供下载。
2. 手动输入期刊全名（支持一次多行多个、支持追加累积）→ 输出对应缩写，可复制/导出。
3. 直观的 UI 界面。
4. 最小可用版本（MVP），先跑通核心链路。

## 技术选型（单一推荐方案）

| 组件 | 选择 | 理由 |
|---|---|---|
| 语言 | Python 3.13（环境已具备） | bib 处理生态最好 |
| 缩写引擎 | PyPI 包 **`iso4`** | 完整实现 ISO 4 规则，内置 LTWA 官方数据，无需联网/申请 ISSN 数据 |
| Bib 解析 | **`bibtexparser`** (v2) | 成熟库，可保留条目顺序与字段，修改后回写 |
| UI | **`Gradio`** | 几行代码即可得到「文件上传 + 文本输入 + 表格 + 下载」的网页 UI，本地浏览器打开即用，是 MVP 最快路径 |

环境检查：Python 3.13.13、pip 26.0.1 已就绪。

## 项目结构

```
C:\Users\29417\Desktop\缩写转换\
├── requirements.txt        # gradio, bibtexparser, iso4
├── abbreviator.py          # 核心：期刊全名 → ISO 4 缩写
├── bib_processor.py        # 解析/改写 bib 的 journal 字段
├── app.py                  # Gradio 界面（入口：python app.py）
└── tests/
    ├── test_abbreviator.py # 已知期刊对照断言（如 Journal of the American Chemical Society → J. Am. Chem. Soc.）
    └── sample.bib          # 测试用示例 bib
```

## 实施步骤

### 第 1 步：环境搭建
- `pip install gradio bibtexparser iso4`（写入 `requirements.txt`）。

### 第 2 步：核心缩写模块 `abbreviator.py`
- 封装 `abbreviate_journal(name: str) -> str`：
  - 用 `iso4.abbreviate()` 做 ISO 4 缩写（内部自动查 LTWA）。
  - 预处理：去首尾空格、去掉开头的定冠词处理交给 iso4；大小写按 ISO 4 规范（首字母大写）。
  - 兜底策略：若某个词在 LTWA 中无缩写规则，保留原词；整体失败时原样返回并标记 `未缩写`，绝不静默丢词。
- 提供 `abbreviate_many(names: list[str]) -> list[tuple[原名, 缩写]]`。

### 第 3 步：Bib 处理模块 `bib_processor.py`
- `process_bib(file_bytes) -> (new_bib_text, report_rows)`：
  - 用 `bibtexparser` 解析；遍历每个 entry，若含 `journal` 字段则替换为缩写值。
  - 未含 `journal` 字段的条目（如 `@book`、`@inproceedings`）跳过并在报告中标注。
  - 保留其余字段与条目顺序，序列化输出新 bib 文本。
  - 返回处理报告：`[(entry_key, 原期刊名, 缩写)]`，供 UI 展示核对。

### 第 4 步：Gradio 界面 `app.py`
- 两个 Tab：
  - **Tab 1「Bib 文件转换」**：`gr.File` 上传 .bib → 处理 → 展示报告 `gr.Dataframe`（条目 key / 原名 / 缩写）+ `gr.File` 输出下载（文件名 `原名_abbreviated.bib`）。
  - **Tab 2「手动输入」**：
    - `gr.Textbox(lines=6)` 一次粘贴多个期刊名（每行一个）。
    - 「生成缩写」按钮 → 结果表格追加显示（用 `gr.State` 保存累积列表，实现**追加**而不是覆盖）。
    - 「清空列表」按钮；结果表格可复制，另提供「导出为 txt」下载（`原名<TAB>缩写` 每行一条，方便粘贴到别处）。
- 启动：`python app.py`，浏览器自动打开 `http://127.0.0.1:7860`。

### 第 5 步：测试与验证
- 单元测试：对照已知 ISO 4 缩写断言（取自 ISSN/LTWA 常见例子）：
  - `Journal of the American Chemical Society` → `J. Am. Chem. Soc.`
  - `Physical Review Letters` → `Phys. Rev. Lett.`
  - `Angewandte Chemie International Edition` → `Angew. Chem. Int. Ed.`
  - `Nature Communications` → `Nat. Commun.`
- 端到端：用 `tests/sample.bib`（含 article/book/缺 journal 条目各若干）走一遍 UI 流程，核对输出 bib 的 journal 字段全部替换、其余字段不变。
- 验证方式：运行 `pytest`，再实际启动 `python app.py` 手动走通两个 Tab。

## 边界与说明（MVP 范围内）
- 缩写规则以 `iso4` 内置 LTWA 数据为准；个别期刊有「官方惯用缩写」与逐词规则缩写不同（极少见），MVP 不做期刊级例外表，后续可加自定义映射。
- 只处理 `journal` 字段；`booktitle`（会议论文）按 ISO 4 规则缩写通常不适用，MVP 跳过。
- 全程本地运行，不联网、不上传任何数据。

## 验收标准
1. 上传 bib → 下载得到 journal 字段已缩写的新 bib，报告表格正确。
2. 手动输入多个期刊名 → 表格显示缩写，可多次追加、可清空、可导出。
3. `pytest` 全绿；`python app.py` 一键启动，UI 两个 Tab 均可用。
