import { spawnSync } from "node:child_process";

const minimumGap = 8;
const vault = process.argv[2] ?? "dev-test";
const evaluation = `(() => {
  const minimumGap = ${minimumGap};
  const headers = [...document.querySelectorAll(".pmi-task-column")];
  const headerResults = headers.map((header) => {
    const label = header.querySelector(":scope > span, .pmi-task-sort-label");
    const handle = header.querySelector(".pmi-task-column-resizer");
    if (!label || !handle) {
      return { label: "missing", gap: -Infinity, justifyContent: "missing", textAlign: "missing" };
    }
    const lineOffset = Number.parseFloat(getComputedStyle(handle, "::after").left);
    const gap = handle.getBoundingClientRect().left + lineOffset - label.getBoundingClientRect().right;
    const style = getComputedStyle(header);
    return {
      label: label.textContent,
      gap: Math.round(gap * 100) / 100,
      justifyContent: style.justifyContent,
      textAlign: style.textAlign
    };
  });
  const rows = [...document.querySelectorAll(".pmi-task-row")];
  const stickyCells = [headers[0], ...rows.map((row) => row.firstElementChild)].filter(Boolean);
  const stickyCellResults = stickyCells.map((cell) => ({
    element: cell.className,
    position: getComputedStyle(cell).position,
    boxShadow: getComputedStyle(cell).boxShadow
  }));
  const recordResults = rows.flatMap((row, rowIndex) =>
    [...row.children].map((cell, index) => ({
      row: rowIndex + 1,
      label: headerResults[index]?.label ?? "missing",
      textAlign: getComputedStyle(cell).textAlign
    }))
  );
  const sortControl = document.querySelector(".pmi-task-sort");
  const plainHeaderLabel = headers.find((header) => !header.querySelector(".pmi-task-sort"))
    ?.querySelector(":scope > span");
  const sortStyle = sortControl ? getComputedStyle(sortControl) : null;
  const sortIcon = sortControl?.querySelector(".pmi-task-sort-icon svg");
  const sortIconStyle = sortIcon ? getComputedStyle(sortIcon) : null;
  const plainLabelStyle = plainHeaderLabel ? getComputedStyle(plainHeaderLabel) : null;
  const sortControlResult = sortStyle && sortIconStyle && plainLabelStyle
    ? {
        borderWidths: [sortStyle.borderTopWidth, sortStyle.borderRightWidth, sortStyle.borderBottomWidth, sortStyle.borderLeftWidth],
        boxShadow: sortStyle.boxShadow,
        backgroundColor: sortStyle.backgroundColor,
        minBlockSize: sortStyle.minBlockSize,
        transform: sortStyle.transform,
        userSelect: sortStyle.userSelect,
        fontSize: sortStyle.fontSize,
        fontWeight: sortStyle.fontWeight,
        iconWidth: sortIconStyle.width,
        iconHeight: sortIconStyle.height,
        plainHeaderFontSize: plainLabelStyle.fontSize,
        plainHeaderFontWeight: plainLabelStyle.fontWeight
      }
    : null;
  const failingSortControl = !sortControlResult ||
    sortControlResult.borderWidths.some((width) => width !== "0px") ||
    sortControlResult.boxShadow !== "none" ||
    !["rgba(0, 0, 0, 0)", "transparent"].includes(sortControlResult.backgroundColor) ||
    sortControlResult.minBlockSize !== "0px" ||
    sortControlResult.transform !== "none" ||
    sortControlResult.userSelect !== "none" ||
    Number.parseFloat(sortControlResult.iconWidth) > Number.parseFloat(sortControlResult.fontSize) ||
    Number.parseFloat(sortControlResult.iconHeight) > Number.parseFloat(sortControlResult.fontSize) ||
    sortControlResult.fontSize !== sortControlResult.plainHeaderFontSize ||
    sortControlResult.fontWeight !== sortControlResult.plainHeaderFontWeight;
  return JSON.stringify({
    minimumGap,
    headerResults,
    recordResults,
    stickyCellResults,
    sortControlResult,
    failingSpacing: headerResults.filter(({ gap }) => gap < minimumGap),
    failingHeaderAlignment: headerResults.filter(
      ({ justifyContent, textAlign }) => justifyContent !== "flex-start" || textAlign !== "start"
    ),
    failingRecordAlignment: recordResults.filter(({ textAlign }) => textAlign !== "start"),
    failingStickyCells: stickyCellResults.filter(
      ({ position, boxShadow }) => position !== "sticky" || boxShadow !== "none"
    ),
    failingSortControl
  });
})()`;

const result = spawnSync("obsidian", [`vault=${vault}`, "eval", `code=${evaluation}`], { encoding: "utf8" });
if (result.error) throw result.error;

const output = `${result.stdout}${result.stderr}`;
const payload = output.match(/=>\s*(\{.*\})/u)?.[1];
if (!payload) throw new Error(`Could not read Obsidian evaluation result:\n${output}`);

const report = JSON.parse(payload);
if (report.headerResults.length === 0) {
  throw new Error("No task table headers found in the active Obsidian view.");
}
if (report.recordResults.length === 0) throw new Error("No task rows found in the active Obsidian view.");

if (
  report.failingSpacing.length > 0 ||
  report.failingHeaderAlignment.length > 0 ||
  report.failingRecordAlignment.length > 0 ||
  report.failingStickyCells.length > 0 ||
  report.failingSortControl
) {
  console.error(
    `Task header layout failed: ${JSON.stringify({
      spacing: report.failingSpacing,
      headerAlignment: report.failingHeaderAlignment,
      recordAlignment: report.failingRecordAlignment,
      stickyCells: report.failingStickyCells,
      sortControl: report.sortControlResult
    })}`
  );
  process.exitCode = 1;
} else {
  console.log(
    `Task columns stay aligned and resizable without drawing a divider beside the sticky title column.`
  );
}
