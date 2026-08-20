# Project Manager Insights

<div align="center">
  <p><code>OBSIDIAN · PROJECT MANAGER 小搭档</code></p>
  <p><strong>藏在 Obsidian Vault 里的小小工作量观测站。</strong></p>
  <p>看看团队全景，顺着线索找到任务，同时让每篇笔记安静待在原处。</p>
  <p>
    <a href="https://community.obsidian.md/plugins/project-manager-insights"><img alt="Obsidian 社区插件" src="https://img.shields.io/badge/Obsidian-Community%20Plugin-7C3AED?style=for-the-badge&amp;logo=obsidian&amp;logoColor=white"></a>
    <a href="https://github.com/CoffeeCheese/obsidian-pm-insights/releases"><img alt="最新版本" src="https://img.shields.io/github/v/release/CoffeeCheese/obsidian-pm-insights?style=for-the-badge&amp;label=Release&amp;color=007ACC&amp;logo=github"></a>
    <a href="https://github.com/CoffeeCheese/obsidian-pm-insights/releases"><img alt="累计下载量" src="https://img.shields.io/github/downloads/CoffeeCheese/obsidian-pm-insights/total?style=for-the-badge&amp;color=2EA44F&amp;logo=github"></a>
    <img alt="Vault 数据只读" src="https://img.shields.io/badge/Vault%20Data-Read%20Only-2F7D8C?style=for-the-badge&amp;logo=markdown&amp;logoColor=white">
  </p>
  <p>
    <a href="https://community.obsidian.md/plugins/project-manager-insights"><strong>从 Obsidian 安装</strong></a>
    ·
    <a href="https://github.com/CoffeeCheese/obsidian-pm-insights/releases">版本发布</a>
    ·
    <a href="https://github.com/CoffeeCheese/obsidian-pm-insights/issues">反馈问题</a>
  </p>
  <p><a href="README.md">English</a> · <strong>简体中文</strong></p>
</div>

![使用虚构演示数据展示跨项目工作量、个人比率、数据质量与任务筛选的 Project Manager Insights 面板](docs/assets/pm-insights-overview.png)

<p align="center"><sub>一张图看完 v0.2 面板：跨项目汇总、数据质量提示、紧凑的六项个人比率，以及可组合的任务筛选。使用 Pixel 主题和虚构数据拍摄，不含任何真实项目信息。</sub></p>

## 🫧 把忙碌的项目装进一个安静窗口

Project Manager Insights 会将 [Project Manager](https://github.com/stepankropachev/obsidian-pm) 创建的笔记整理成友好的跨项目工作量视图。看看计划与已登记工时如何分布，找出模糊的数据，再顺着每个数字回到具体任务。

```text
项目  ──→  团队快照  ──→  成员  ──→  任务
选择          扫一眼          聚焦        追踪
```

> [!NOTE]
> **小插件也有认真约定：** 它会读取 Project Manager 数据，但绝不会修改项目或任务笔记。

## ✨ 用 30 秒逛一圈

1. **选几个项目。** 自由组合 Vault 中的任意 Project Manager 项目。
2. **看看团队信号。** 对比计划、已登记、剩余和超出工时。
3. **找到工作量。** 选择一位成员，分开查看个人工作与共享工作。
4. **顺着线索走。** 搜索任务、组合项目与状态筛选，再打开源任务，同时保留当前面板。

| 观测站里有什么 | 你能看到什么 |
| --- | --- |
| 🛰️ **团队快照** | 汇总所选项目的计划、已登记、剩余和超出工时。 |
| 👤 **成员卡片** | 展示每个人的任务数量和工作量轨道，并分开统计个人与共享工作。 |
| 🧭 **个人交付账本** | 按交付、工时和数据基础分组展示六项个人比率。 |
| 🔎 **任务抽屉** | 支持搜索、多选项目与状态筛选，以及手动调整任务列宽。 |
| 🪟 **Project Manager 联动** | 在任务编辑弹窗中打开任务，或在新页签打开所属项目。 |
| 🧹 **质量提示** | 展示纳入统计的子任务总数，并提示未估算、未分配和已排除的父任务。 |

窄屏下任务列会留在原位，其余字段可以横向滚动。界面支持英文与简体中文，并会借用当前 Obsidian 主题的颜色。

## 🔭 不离开面板，继续追踪

成员详情把排查动作放在数字旁边：

- **只筛选当前存在的内容。** 项目与状态选项来自当前成员的任务，两组条件都支持多选，并可与文字搜索组合使用。
- **自然收起菜单。** 点击菜单外部或按下 `Escape` 即可关闭项目与筛选菜单，同时保留已经选择的条件。
- **让任务留在上下文里。** 点击任务标题，会在当前工作量面板上方打开 Project Manager 的任务编辑弹窗；点击项目名称，则在新页签打开对应的 Project Manager 项目页。
- **按问题调整表格。** 拖拽列分隔线即可调整宽度，也可使用方向键精细调整；双击分隔线会恢复默认布局。表头与记录内容使用一致的左对齐基线。

直接打开任务详情目前支持 Project Manager `1.8.x`。PM Insights 本身仍不会写入任务笔记；在 Project Manager 编辑器内产生的修改由 Project Manager 负责。

## 🧭 六项比率，回答三个问题

成员姓名右侧的紧凑账本分别回答交付、工时与数据基础问题，不会在成员和任务之间再塞入一层大型面板。

| 分组 | 比率 | 计算方式 |
| --- | --- | --- |
| **交付** | 任务闭环 | 已完成且未取消的任务 ÷ 全部未取消任务。 |
| **交付** | 计划工时闭环 | 已完成任务的计划工时 ÷ 全部已估算工时。 |
| **工时** | 工时消耗 | 已估算任务的登记工时 ÷ 对应计划工时。 |
| **工时** | 超支任务 | 登记工时超过计划的已开工任务 ÷ 全部已开工且有估算的任务。 |
| **数据基础** | 估算命中 | 登记工时处于估算 ±20% 范围内的已完成、已开工任务 ÷ 全部已完成、已开工且有估算的任务。 |
| **数据基础** | 估算覆盖 | 已填写计划工时的未取消任务 ÷ 全部未取消任务。 |

短横线表示当前还没有有效样本，不会被误报为 0%。

## 🧮 小仪表是怎样计算的

| 仪表 | 计算方式 |
| --- | --- |
| **计划** | 汇总纳入统计任务的预估工时。 |
| **已登记** | 汇总任务的工时登记记录。 |
| **剩余** | 对未完成、已估算且未归档的任务计算 `max(计划 - 已登记, 0)`。 |
| **超出** | 对已估算的任务计算 `max(已登记 - 计划, 0)`。 |

为了让快照保持可信：

- 共享任务只计入团队总数一次，同时出现在每位负责人的 **共享** 工作条中。
- 默认情况下，明确标记为 `type: task` 的根任务不参与汇总，即使它还没有子任务；缺少类型信息时，仍根据 `parentId` 关系识别父任务，避免父子任务重复计算。启用 **统计父任务** 后，整个面板会切换为仅统计父任务，并排除子任务。
- 已完成任务以及勾选纳入统计的已归档任务会保留计划与已登记工时，但不再增加剩余工时。
- 未分配和未估算任务不会悄悄消失，而是继续作为数据质量提示展示。
- 成员别名可以将不同写法归到同一个规范名称下，同时不改变源笔记。

## 🚀 邀请它住进你的 Vault

你需要：

- Obsidian `1.7.2` 或更高版本。
- [Project Manager](https://github.com/stepankropachev/obsidian-pm) 插件，以及至少一个 Project Manager 项目。

你可以从 [Obsidian 官方社区目录安装 Project Manager Insights](https://community.obsidian.md/plugins/project-manager-insights)，也可以前往 **设置 → 第三方插件 → 浏览**，搜索 **Project Manager Insights** 后点击 **安装**并**启用**。

点击侧边栏中的 **PM Insights** 图标，或在命令面板运行 **PM Insights: 打开工作量洞察**。选好项目与成员，就可以出发啦。语言与成员别名设置位于 **设置 → PM Insights**。

## 🛠️ 搭建这座观测站

```bash
# 启动开发构建
npm run dev

# 类型检查、代码检查、测试并创建生产构建
npm run check
```

## 🌱 小小体积，安静工作

PM Insights 只读取本地 Vault 中的 Project Manager 元数据。它不会编辑项目或任务笔记，当前插件也没有任何网络集成。

送给喜欢项目脉络清清楚楚、Vault 安安静静的你。☕

## 许可证

[MIT](LICENSE)
