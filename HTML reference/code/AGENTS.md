# JSONL Field Selector - 需求拆解文档

## 产品概述

- **产品类型**: 客户端 JSONL 数据处理工具（参照原 JSONL Splitter，本地零上传）
- **场景类型**: <scene_type>prototype-app</scene_type>
- **目标用户**: 需要清洗 / 精简 JSONL 数据的数据运营与标注人员（用户为 ByteDance 数据标注与评估运营团队），希望上传 JSONL 后勾选保留字段，导出只含所需字段的干净数据
- **核心价值**: 上传 JSONL → 自动探测所有字段 → 勾选要保留的字段 → 导出只含所选字段的 clean JSONL
- **界面语言**: English (en-US)
- **主题偏好**: 浅色（沿用原站浅色 + system-ui 极简风格）
- **导航模式**: 无导航（单页工具）
- **导航布局**: 无

> 说明：参照对象 https://ruaddin.github.io/jsonl_splitter/ 已通过 web_fetch 获取完整源码 + 截图，其为纯客户端单页工具（拖拽上传 → 参数配置 → 报告 → Blob 下载，Nothing leaves this machine）。本需求在其基础上，把「拆分超长字段」的核心能力替换 / 扩展为「字段勾选保留」能力。全程浏览器本地处理，无后端、无网络请求。

---

## 页面结构总览

> 单页工具，无路由。以下为页面区块结构。

**页面文件**: `MainPage.tsx`

| 区域 | 说明 |
|-----|------|
| Header | 标题「JSONL Field Selector」+ 副标题（强调本地处理、字段勾选导出） |
| 上传区 (Drop Zone) | 拖拽 / 点击浏览 `.jsonl / .json / .txt` 文件；已加载后显示文件名 + 大小 |
| 字段选择区 (Field Selector) | 探测到的所有顶层字段列表，每个字段带 checkbox、出现频次（在多少条记录中出现）、类型标签、示例值；提供「Select all / None / Invert」快捷操作与字段搜索框 |
| 导出选项区 (Options) | 输出格式（JSONL / CSV）、是否丢弃未选字段全空的空对象记录、字段顺序（按原始出现顺序 / 按勾选顺序） |
| 预览区 (Preview) | 实时展示应用字段筛选后的前 N 条输出结果（等宽字体、可横向滚动）；初始态为空状态占位 |
| 汇总 + 导出 (Summary + Download) | 统计（读取记录数、解析失败行数、字段总数 / 已选字段数）+ 「Download clean .jsonl」按钮 |

---

## 页面布局建议

- **布局模式**: 上下分区 + 左右分栏 —— 上传/选项在顶部；下方桌面端左右分栏：左侧「字段选择区」（源数据字段作为需持续参照的材料），右侧「预览区」（筛选后结果）并列对照，移动端上下堆叠。这样用户勾字段时能实时看到输出效果。
- **视觉重心**: 字段选择区（勾选字段是本工具区别于原站的核心动作）+ 预览结果
- **结果承载区**: 右侧预览区（渲染筛选后 JSONL 前 N 行）+ 底部汇总统计；初始态为空状态（提示「Upload a .jsonl file to begin」），加载后即时渲染预览骨架

---

## 数据来源声明

| 数据/操作 | 来源类型 | 实现要求 | mock 兜底 |
|---|---|---|---|
| JSONL 文件读取 | real-file | 浏览器 File API（`<input type="file">` + 拖拽 + FileReader.readAsText）读取用户选择的 .jsonl/.json/.txt，按行 split + JSON.parse 逐行解析为记录数组 | 无（无文件时展示空状态，不塞假数据） |
| 字段探测（union of keys） | real-file | 遍历已解析记录，收集所有顶层 key 的首次出现顺序、出现频次、值类型、示例值，生成字段清单 setState | 无（源自真实上传数据） |
| 字段勾选保留 | demo-mock | 纯前端 state：勾选集合 `Set<string>`，对每条记录只挑出被勾选的 key 重建对象（本身即前端逻辑，无外部数据） | ✅ 逻辑本身，非数据 |
| 结果预览 | real-file | 对筛选后记录取前 N 条，`JSON.stringify` 逐行渲染到预览区 | 无 |
| 导出 clean JSONL / CSV | import-export | Blob（`application/x-ndjson` 或 `text/csv`）+ `URL.createObjectURL` + `a.click()`，文件名 `原名_clean.jsonl`；每行仅含所选字段 | 无 |

> 全流程纯客户端，无 AI / 网络能力，故无「插件规划」章节。解析、字段探测、数值计算均程序化执行，不硬编码数据、不手动估算。

---

## 功能列表

- **页面/区块**: 上传区 (Drop Zone)
  - **页面目标**: 让用户把本地 JSONL 交给工具，全程不出机器
  - **功能点**:
    - **拖拽上传**: 拖入 `.jsonl/.json/.txt` 文件，dragover 高亮边框，drop 触发读取；也支持点击浏览
    - **文件读取与解析**: FileReader 读文本 → 按 `\n` split → 逐行 `JSON.parse`；空行忽略，解析失败行计数并跳过（不中断）
    - **文件信息展示**: 显示文件名 + 大小（MB）；重新上传可替换

- **页面/区块**: 字段选择区 (Field Selector)
  - **页面目标**: 让用户明确勾选「要保留哪些字段」（本工具核心差异点）
  - **功能点**:
    - **勾选保留字段**: 每个探测到的顶层字段一行 checkbox；勾选集合变化实时驱动预览与汇总重算
    - **字段元信息展示**: 每字段显示出现频次（`出现记录数 / 总记录数`）、推断类型（string/number/boolean/object/array/null）、截断示例值
    - **批量操作**: Select all / Select none / Invert selection 三个快捷按钮
    - **字段搜索**: 输入框按字段名过滤长字段列表

- **页面/区块**: 导出选项区 (Options)
  - **页面目标**: 控制导出格式与边界行为
  - **功能点**:
    - **切换输出格式**: JSONL / CSV 下拉，切换后预览与下载按钮文案同步更新
    - **空记录处理**: 勾选「Drop records that become empty」开关，剔除筛选后无任何所选字段的记录
    - **字段顺序**: 选择输出字段顺序（原始出现顺序 / 勾选先后顺序）

- **页面/区块**: 预览区 (Preview)
  - **页面目标**: 让用户在下载前确认输出正确
  - **功能点**:
    - **实时预览**: 渲染筛选后前 N 条（默认 20）记录的 JSONL/CSV 文本，等宽字体、横向滚动
    - **空状态**: 未上传时显示引导占位；无勾选字段时提示「Select at least one field」

- **页面/区块**: 汇总 + 导出 (Summary + Download)
  - **页面目标**: 给出处理概况并一键导出干净数据
  - **功能点**:
    - **统计展示**: 读取记录数、解析失败行数、字段总数、已选字段数
    - **导出下载**: 点击「Download clean .jsonl」（CSV 时文案切 .csv），Blob 生成仅含所选字段的每行记录并触发下载；无勾选字段时按钮禁用

---

## 数据共享配置

单页应用，所有状态在 `MainPage.tsx` 内部 state 管理，无需跨页面全局存储。核心 TypeScript 类型如下，供 Code Agent 使用：

```ts
/** 单条解析后的 JSONL 记录（顶层键值对，值保持原始 JSON 类型） */
type JsonlRecord = Record<string, unknown>;

/** 字段探测结果 */
interface FieldInfo {
  /** 顶层字段名 */
  key: string;
  /** 在多少条记录中出现 */
  occurrences: number;
  /** 推断出的值类型集合（同名字段可能多类型） */
  types: Array<'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'>;
  /** 截断后的示例值（用于预览展示） */
  sample: string;
}

/** 导出选项 */
interface ExportOptions {
  /** 输出格式 */
  format: 'jsonl' | 'csv';
  /** 剔除筛选后为空的记录 */
  dropEmpty: boolean;
  /** 字段输出顺序 */
  order: 'original' | 'selection';
}

-------

<scene_type>prototype-app</scene_type>

# UI 设计指南

## 1. 设计推导依据

- **参考意图**: Mood Reference —— 迁移原站的信息密度、单色克制和 mono 字体的工程质感；不照搬其冷蓝品牌色与朴素灰白，为"字段挑选导出"这个新核心动作重建视觉锚点。
- **核心情绪 / 应用类型**: 本地纯前端 JSONL 清洗工具，让数据标注运营从脏 JSONL 里勾选保留字段、导出干净数据——冷静、精确、可信、数据不出本机。
- **独特记忆点**: 字段挑选面板——从首条记录自动嗅探出的所有 key 排成可勾选清单，每个字段带类型徽标与出现率百分比，勾选即时驱动右侧 mono 预览行的列增减。

## 2. Art Direction

- **方向名**: 精密工作台 / Precision Console
- **Design Style**: Swiss Minimalist + Monochrome 单色克制 —— 数据工具需要网格秩序与低干扰，让 mono 数据本身成为视觉主体。
- **DNA 参数**: 圆角 subtle（`rounded-md`）/ 阴影 none~subtle（`shadow-none` 结构靠 border）/ 间距 compact-standard（`gap-3`/`p-5`）/ 字体方向 sans UI + mono 数据 / 装饰手法 单像素分隔线与字段类型徽标，无渐变无插图。
- **应用类型**: Tool —— 单页纵向工作流：上传 → 字段挑选 → 报告/预览 → 导出。

## 3. Color System

**色彩关系**: 靛青主色 + 同色极浅选中底 + 近白冷灰工作台背景 + 石墨文字。
**配色设计理由**: primary 靛青只承担"导出 / 已选中字段 / 拖拽激活"三处主行动与状态锚；工作台背景走近白冷灰让 mono 数据读感锐利；accent 是靛青稀释后的浅底，专供字段行 hover、勾选行底与 focus 环，与 primary 拉开权重。
**主色推导**: 靛青（indigo）对应数据管线、工程精度与"筛选/过滤"动作的冷静语义，比原站的通用亮蓝更有工具身份、饱和更克制。
**使用比例**: 60% 中性冷灰白 / 30% 边框与 mono 文本 / 10% 靛青 primary；严禁主按钮、tab、icon、边框、链接同时使用 primary。

| 角色 | CSS 变量 | Tailwind Class | HSL 值 | 设计说明 |
|---|---|---|---|---|
| bg | `--background` | `bg-background` | hsl(220 20% 98%) | 工作台冷灰白背景 |
| card | `--card` | `bg-card` | hsl(0 0% 100%) | 面板、字段清单、预览、报告容器 |
| text | `--foreground` | `text-foreground` | hsl(222 25% 14%) | 标题与正文 |
| textMuted | `--muted-foreground` | `text-muted-foreground` | hsl(220 10% 46%) | 字段计数、提示、单位说明 |
| primary | `--primary` | `bg-primary` / `text-primary` | hsl(232 62% 52%) | 导出按钮、已选字段标记、拖拽激活 |
| primaryForeground | `--primary-foreground` | `text-primary-foreground` | hsl(0 0% 100%) | primary 上文字与图标 |
| accent | `--accent` | `bg-accent` | hsl(232 60% 96%) | 字段行 hover、勾选行浅底、focus 环底 |
| accentForeground | `--accent-foreground` | `text-accent-foreground` | hsl(232 55% 40%) | accent 上低权重文字与类型徽标字 |
| border | `--border` | `border-border` | hsl(220 14% 89%) | 输入框、面板、分隔线、清单行线 |

**语义色提示**: success `bg hsl(152 50% 96%) / border hsl(152 40% 78%) / text hsl(152 55% 30%)` 用于"无警告 / 导出就绪"；warning `bg hsl(38 90% 96%) / border hsl(38 75% 74%) / text hsl(32 70% 38%)` 用于精度丢失提示；error `bg hsl(0 75% 97%) / border hsl(0 65% 82%) / text hsl(0 62% 45%)` 用于无效 JSON / 键冲突。三色饱和度均收于 50-62%，与 primary（62%）同区间，避免报警色刺眼于冷静工作台。

## 4. 字体与节奏

- **font-display**: Space Grotesk —— 标题带机械几何感，契合数据工具的精密身份。
- **font-body**: Inter（UI 文本）+ IBM Plex Mono（所有 JSON key / value / 预览 / 计数）—— mono 让字段数据成为可信主体。
- **字号**: H1 text-2xl~text-3xl（工具紧凑，不用巨标题）；H2 text-lg；body text-sm；数据/预览 text-xs~text-sm mono；muted text-xs。
- **圆角**: 中（`rounded-md`）—— 输入、按钮、面板统一，勾选框可 `rounded-sm`。

## 5. 全局布局契约

- **Reference Layout Use**: 沿用原站单栏纵向工作流与顶部标题+副说明结构；新增"字段挑选"作为上传后的核心区块，替换原站直接下载的路径。
- **Page / Section Order**: 标题区 → 上传/拖拽区 → 导出选项行（保留字段模式、格式、字段展开开关）→ 字段挑选面板（清单 + mono 预览）→ 报告/警告 → 导出按钮。
- **Standard Content Zone**: `max-w-5xl` + `mx-auto`（Tool，略宽于原站以容纳字段清单与预览并排）。
- **Shell / Frame Alignment**: 同宽——所有面板共享同一容器宽度纵向堆叠，无侧边导航。
- **Padding & Rhythm**: `px-4 md:px-6 py-8 md:py-12`，面板内 `p-5`，区块间 `gap-4`，保持 8px 倍数节奏。
- **Full-bleed Zones**: 无全宽背景图；拖拽区为容器内虚线框满宽。
- **Local Narrowing**: 导出选项行内的数字/文本输入按内容收窄（如 `w-32`），不撑满整行。
- **Overflow Strategy**: mono 预览行、字段清单超高时用 `overflow-x-auto` / `max-h-[420px] overflow-y-auto`，不放大全局 max-w。
- **Flexibility Boundary**: 允许移动端 padding 与字段清单单列/双列切换；不允许按区块切换 max-w、圆角、阴影或主色。

## 6. 视觉与动效

- **装饰**: 单像素分隔线、字段类型徽标（string/number/object/array 用中性小标签）。
- **阴影/边界**: 无阴影，结构完全靠 `border` 与背景层级；拖拽激活时边框转 primary。
- **动效**: 克制 —— 字段勾选/取消用 120ms 背景与预览列淡入；拖拽 over 态边框色 120ms 过渡；按钮 hover 仅背景明度微变，无位移无缩放。

## 7. 组件原则

- 按钮、勾选框、下拉、字段行必须有 Default / Hover / Active / Focus-visible / Disabled 状态；focus-visible 用 2px accent 环。
- Primary 只给"Download"主行动；格式/模式选择用 outline 分段或 select；字段行 hover/selected 用 accent 浅底承接，勾选状态叠加 primary 左边线或勾标。
- 加载（解析大文件）与空状态（未上传 / 无字段）延续 mono + 冷灰语言，空态给"Drop a .jsonl to detect fields"引导文案，不回退默认 shadcn 样式。

## 8. Image Direction

- **Image Role**: 无强制图片需求，优先通过 mono 排版、单色网格、字段徽标与分隔线建立视觉记忆点。

## 9. Anti-patterns

- **Split personality**: 字段面板与报告面板用不同 max-w 或圆角；全站共享同一容器与 `rounded-md`。
- **Phantom tokens**: 编造未定义变量；仅用上表 9 角色与三态语义色。
- **Default SaaS drift**: 回到通用亮蓝按钮加卡片阴影堆叠；用靛青 primary + 无阴影 border 结构塑造工具身份。
- **Invisible interaction**: 字段行做了 hover 底却漏 focus-visible；每个勾选行、输入、按钮键盘可达且有可见环。
- **Mono-hue tyranny**: 靛青铺满按钮+勾选框+徽标+边框+链接；按 60-30-10 收回到导出与选中态，边框与类型徽标交给中性灰。
- **Status color drift**: warning/error 饱和度飙高刺眼；三态语义色须与 primary 同处 50-62% 饱和区间。