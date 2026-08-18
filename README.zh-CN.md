<div align="center">
  <p><code>OBSIDIAN · PROJECT MANAGER 小搭档</code></p>
  <h1>Project Manager Insights ✨</h1>
  <p><strong>藏在 Obsidian Vault 里的小小工作量观测站。</strong></p>
  <p>看看团队全景，顺着线索找到任务，同时让每篇笔记安静待在原处。</p>
  <p>
    <a href="https://community.obsidian.md/plugins/project-manager-insights"><strong>从社区插件市场安装</strong></a>
    ·
    <a href="#-用-30-秒逛一圈">用 30 秒逛一圈</a>
  </p>
  <p><a href="README.md">English</a> · <strong>简体中文</strong></p>
</div>

![使用虚构演示数据展示的 Project Manager Insights 工作量面板](docs/assets/pm-insights-overview.png)

<p align="center"><sub>一间轻快的小小控制室——使用 Pixel 主题和虚构数据拍摄，不含任何真实项目数据。</sub></p>

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
4. **顺着线索走。** 搜索并筛选任务抽屉，确认每一份工时来自哪里。

| 观测站里有什么 | 你能看到什么 |
| --- | --- |
| 🛰️ **团队快照** | 汇总所选项目的计划、已登记、剩余和超出工时。 |
| 👤 **成员卡片** | 展示每个人的任务数量和工作量轨道，并分开统计个人与共享工作。 |
| 🔎 **任务抽屉** | 搜索任务，查看所属项目、状态、计划、已登记和剩余工时。 |
| 🧹 **质量提示** | 温和提醒未估算、未分配以及已排除父任务等数据问题。 |

窄屏下任务列会留在原位，其余字段可以横向滚动。界面支持英文与简体中文，并会借用当前 Obsidian 主题的颜色。

## 🧮 小仪表是怎样计算的

| 仪表 | 计算方式 |
| --- | --- |
| **计划** | 汇总纳入统计任务的预估工时。 |
| **已登记** | 汇总任务的工时登记记录。 |
| **剩余** | 对未完成、已估算且未归档的任务计算 `max(计划 - 已登记, 0)`。 |
| **超出** | 对已估算的任务计算 `max(已登记 - 计划, 0)`。 |

为了让快照保持可信：

- 共享任务只计入团队总数一次，同时出现在每位负责人的 **共享** 工作条中。
- 存在子任务的父任务不参与汇总，避免父子任务重复计算。
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
