import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const run = (args) => {
  const result = spawnSync("obsidian", [`vault=${vault}`, ...args], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${result.stdout}${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
};

run(["command", "id=project-manager-insights:open-assignee-workload-insights"]);

const code = `(async () => {
  const root = document.querySelector(".pmi-root");
  if (!root) return JSON.stringify({ setup: false, reason: "missing root" });
  const openedDashboard = !document.querySelector(".pmi-personal-delivery-dashboard");
  if (openedDashboard) {
    root.querySelector(".pmi-member")?.click();
    await new Promise(resolve => setTimeout(resolve, 100));
    root.querySelector(".pmi-member-dashboard-toggle")?.click();
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const summary = document.querySelector(".pmi-personal-summary");
  const card = summary?.querySelector(".pmi-personal-summary-card.is-delivery-capacity");
  if (!(summary instanceof HTMLElement) || !(card instanceof HTMLElement)) {
    return JSON.stringify({ setup: false, reason: "missing capacity card" });
  }
  const originalSummaryStyle = summary.getAttribute("style");
  const originalCardContent = [...card.childNodes];
  try {
    summary.style.width = "616px";
    card.replaceChildren();
    const button = document.createElement("button");
    button.className = "pmi-personal-capacity-checkpoint is-overdue";
    button.type = "button";
    button.innerHTML = '<div class="pmi-personal-capacity-checkpoint-head"><strong>9月24日</strong><em>逾期负载 1h</em><span>阶段窗口 4 个工作日 · 1 个项目</span></div><span class="pmi-personal-capacity-projects">内贸经营迭代V1.0.8（2026/9/21~2026/09/30）</span><div class="pmi-personal-capacity-rail" style="--pmi-capacity-load-width:100%;--pmi-capacity-limit-position:96%"><span class="pmi-personal-capacity-load"></span><span class="pmi-personal-capacity-limit"></span></div><div class="pmi-personal-capacity-checkpoint-foot"><span>累计 1h / 容量 32h</span><span>本窗口新增 1h</span></div>';
    const list = document.createElement("div");
    list.className = "pmi-personal-capacity-checkpoints";
    list.append(button);
    card.append(list);
    const rects = (selector) => {
      const el = button.querySelector(selector);
      const range = document.createRange();
      range.selectNodeContents(el);
      return [...range.getClientRects()].map(r => ({ left:r.left, right:r.right, top:r.top, bottom:r.bottom }));
    };
    const overlaps = (a,b) => a.some(x => b.some(y =>
      Math.min(x.right,y.right)-Math.max(x.left,y.left)>1 &&
      Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1));
    const cases = [];
    const fixtures = [
      { name: "screenshot", meta: "阶段窗口 4 个工作日 · 1 个项目", status: "逾期负载 1h", foot: "本窗口新增 1h" },
      { name: "dense", meta: "阶段窗口 14 个工作日 · 12 个项目 · 包含周末", status: "逾期负载 1000h", foot: "本窗口新增 1000h" }
    ];
    for (const fixture of fixtures) {
      button.querySelector(".pmi-personal-capacity-checkpoint-head span").textContent = fixture.meta;
      button.querySelector(".pmi-personal-capacity-checkpoint-head em").textContent = fixture.status;
      button.querySelector(".pmi-personal-capacity-checkpoint-foot span:last-child").textContent = fixture.foot;
      for (const width of [616, 740, 900]) {
        summary.style.width = width + "px";
        await new Promise(resolve => requestAnimationFrame(resolve));
        const date = rects(".pmi-personal-capacity-checkpoint-head strong");
        const meta = rects(".pmi-personal-capacity-checkpoint-head span");
        const status = rects(".pmi-personal-capacity-checkpoint-head em");
        const footA = rects(".pmi-personal-capacity-checkpoint-foot span:first-child");
        const footB = rects(".pmi-personal-capacity-checkpoint-foot span:last-child");
        const buttonRect = button.getBoundingClientRect();
        const textRects = [...date, ...meta, ...status, ...footA, ...footB];
        cases.push({ fixture: fixture.name, width, cardWidth: card.getBoundingClientRect().width,
          headerOverlap: overlaps(date,status)||overlaps(meta,status),
          footerOverlap: overlaps(footA,footB),
          textOverflow: textRects.some(r => r.left < buttonRect.left - 1 || r.right > buttonRect.right + 1) });
      }
    }
    return JSON.stringify({ setup:true,cases });
  } finally {
    card.replaceChildren(...originalCardContent);
    if (originalSummaryStyle === null) summary.removeAttribute("style");
    else summary.setAttribute("style",originalSummaryStyle);
    if (openedDashboard) {
      card.closest(".modal-container")?.querySelector(".modal-close-button, .modal-header-button")?.click();
    }
  }
})()`;
const output = run(["eval", `code=${code}`]);
const payload = output.match(/=>\s*(\{.*\})/u)?.[1];
if (!payload) throw new Error(output);
const report = JSON.parse(payload);
console.log(JSON.stringify(report, null, 2));
if (!report.setup || report.cases.some(item => item.headerOverlap || item.footerOverlap || item.textOverflow)) {
  process.exitCode = 1;
}
