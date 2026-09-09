import { describe, expect, it } from "vitest";
import { decideProjectLaunch, projectLaunchState, type LaunchContext } from "../src/domain/project-launch";
import { DEFAULT_SETTINGS, type ProjectGateDelayPlan, type TaskRecord } from "../src/model";
import { normalizeInsightSettings } from "../src/settings-data";

function context(): LaunchContext {
  const task: TaskRecord = {
    id: "root", projectId: "p1", parentId: null, hierarchy: "root", title: "Requirement", path: "root.md",
    status: "done", priority: null, tags: [], assignees: ["A"], estimate: 0, logged: 0,
    progress: 100, completed: true, completedAt: "2026-09-04", archived: false
  };
  return {
    projectId: "p1", tasks: [task, { ...task, id: "dev", parentId: "root", hierarchy: "subtask", tags: ["type/dev"] }],
    settings: structuredClone(DEFAULT_SETTINGS.deliveryProgress), includeArchived: false,
    schedule: { startDate: "2026-09-01", stageGates: { design: "2026-09-02", development: "2026-09-03", testing: "2026-09-04" },
      acceptanceGate: "2026-09-04", launchDate: "2026-09-07", includeWeekends: false, countSameDayGateAsDay: false },
    actuals: undefined, delay: undefined, today: "2026-09-10", now: "2026-09-10T09:00:00.000Z"
  };
}

function confirm(input: LaunchContext, date = "2026-09-08"): LaunchContext {
  const decision = decideProjectLaunch(input, { kind: "confirm", date });
  expect(decision.kind).toBe("changed");
  if (decision.kind !== "changed") throw new Error(JSON.stringify(decision));
  return { ...input, ...decision.next };
}

function delay(): ProjectGateDelayPlan {
  const forecast = { stageGates: { design: "2026-09-02", development: "2026-09-03", testing: "2026-09-04" },
    acceptanceGate: "2026-09-04", launchDate: "2026-09-11" };
  return { status: "confirmed", confirmed: forecast, confirmedRevisionId: "r1", revisions: [{
    id: "r1", createdAt: "2026-09-03T09:00:00.000Z", kind: "confirmed", reason: "Deployment window", forecast, stages: [], changes: {}
  }] };
}

describe("project launch decisions", () => {
  it("requires confirmation without delay history and records reconciled acceptance", () => {
    const input = context();
    expect(projectLaunchState(input)).toMatchObject({ state: "ready", date: null, acceptanceDate: "2026-09-04" });
    const launched = confirm(input);
    expect(projectLaunchState(launched)).toMatchObject({ state: "launched", date: "2026-09-08", baselineVariance: 1 });
    expect(launched.actuals?.events.at(-1)).toMatchObject({ kind: "launch", acceptanceDateAtLaunch: "2026-09-04", delayStatusBeforeLaunch: null });
    expect(input.actuals).toBeUndefined();
    expect(input.tasks.every((task) => task.completed)).toBe(true);
  });

  it("checks current tasks, not a stale acceptance pass", () => {
    const ready = confirm(context());
    const input: LaunchContext = { ...context(), actuals: structuredClone(ready.actuals!) };
    delete input.actuals!.launchDate;
    input.tasks[0]!.completed = false;
    expect(projectLaunchState(input).blocker).toBe("acceptance-pending");
  });

  it.each(["2026-09-03", "2026-09-11", "2026-02-30", "bad", ""]) ("rejects invalid or out-of-range date %s", (date) => {
    expect(decideProjectLaunch(context(), { kind: "confirm", date })).toEqual({ kind: "rejected", reason: "invalid-date" });
  });

  it("accepts both date endpoints and distinguishes weekends", () => {
    expect(confirm(context(), "2026-09-04").actuals?.launchDate).toBe("2026-09-04");
    expect(confirm(context(), "2026-09-10").actuals?.launchDate).toBe("2026-09-10");
    const input = context(); input.schedule!.launchDate = "2026-09-04";
    const launched = confirm(input, "2026-09-07");
    expect(projectLaunchState(launched).baselineVariance).toBe(1);
    launched.schedule!.includeWeekends = true;
    expect(projectLaunchState(launched).baselineVariance).toBe(3);
  });

  it("rejects empty projects, missing schedules and pending delay drafts", () => {
    expect(projectLaunchState({ ...context(), tasks: [] }).blocker).toBe("acceptance-pending");
    expect(projectLaunchState({ ...context(), schedule: undefined }).blocker).toBe("schedule-invalid");
    const plan = delay(); plan.draft = structuredClone(plan.confirmed!);
    expect(decideProjectLaunch({ ...context(), delay: plan }, { kind: "confirm", date: "2026-09-08" }))
      .toEqual({ kind: "rejected", reason: "delay-draft-pending" });
  });

  it("closes delay plans and restores them after correction and revocation", () => {
    const initial = { ...context(), delay: delay() };
    const launched = confirm(initial);
    expect(launched.delay?.status).toBe("completed");
    expect(projectLaunchState(launched).forecastVariance).toBe(-3);
    const corrected = decideProjectLaunch(launched, { kind: "correct", date: "2026-09-09", reason: "Deployment log" });
    if (corrected.kind !== "changed") throw new Error("Expected correction");
    const current = { ...launched, ...corrected.next };
    const revoked = decideProjectLaunch(current, { kind: "revoke", reason: "Staging only" });
    if (revoked.kind !== "changed") throw new Error("Expected revocation");
    expect(revoked.next.delay).toEqual(initial.delay);
    expect(revoked.next.actuals.launchDate).toBeUndefined();
    expect(revoked.next.actuals.launchRecordedAt).toBeUndefined();
    expect(revoked.next.actuals.events.filter((event) => event.gateId === "launch").map((event) => event.kind))
      .toEqual(["launch", "launch-corrected", "launch-revoked"]);
    const again = confirm({ ...current, ...revoked.next }, "2026-09-10");
    expect(again.actuals?.events.at(-1)?.delayStatusBeforeLaunch).toBe("confirmed");
    expect(initial.delay.status).toBe("confirmed");
  });

  it("keeps the launch fact after tasks reopen and uses original acceptance for corrections", () => {
    const launched = confirm(context());
    launched.tasks[0]!.completed = false;
    launched.actuals!.gates.acceptance = { date: "2026-09-10", recordedAt: launched.now, source: "observed", open: true };
    expect(projectLaunchState(launched)).toMatchObject({ state: "launched", openTaskCount: 1, acceptanceDate: "2026-09-04" });
    expect(decideProjectLaunch(launched, { kind: "correct", date: "2026-09-05", reason: "Corrected" }).kind).toBe("changed");
  });

  it.each(["resolved", "restored", "withdrawn"] as const)("restores a %s plan rather than inventing a confirmed forecast", (status) => {
    const plan: ProjectGateDelayPlan = { status, revisions: [] };
    const launched = confirm({ ...context(), delay: plan });
    const revoked = decideProjectLaunch(launched, { kind: "revoke", reason: "Correct recording" });
    if (revoked.kind !== "changed") throw new Error("Expected revocation");
    expect(revoked.next.delay).toEqual(plan);
  });

  it("is idempotent and requires reasons for corrections and revocation", () => {
    const launched = confirm(context());
    expect(decideProjectLaunch(launched, { kind: "confirm", date: "2026-09-08" })).toEqual({ kind: "unchanged" });
    expect(decideProjectLaunch(launched, { kind: "confirm", date: "2026-09-09" })).toEqual({ kind: "rejected", reason: "already-launched" });
    expect(decideProjectLaunch(launched, { kind: "correct", date: "2026-09-08", reason: "No change" })).toEqual({ kind: "unchanged" });
    expect(decideProjectLaunch(launched, { kind: "revoke", reason: " " })).toEqual({ kind: "rejected", reason: "reason-required" });
    expect(decideProjectLaunch(launched, { kind: "correct", date: "2026-09-09", reason: " " })).toEqual({ kind: "rejected", reason: "reason-required" });
  });

  it("preserves new audit metadata through settings normalization", () => {
    const launched = confirm({ ...context(), delay: delay() });
    const revoked = decideProjectLaunch(launched, { kind: "revoke", reason: "Revert" });
    if (revoked.kind !== "changed") throw new Error("Expected revocation");
    const normalized = normalizeInsightSettings({ gateActuals: { p1: revoked.next.actuals } });
    expect(normalized.gateActuals.p1).toEqual(revoked.next.actuals);
    const withoutPlan = confirm(context());
    expect(normalizeInsightSettings({ gateActuals: { p1: withoutPlan.actuals! } }).gateActuals.p1?.events.at(-1)?.delayStatusBeforeLaunch).toBeNull();
  });

  it("restores legacy delay decisions or refuses ambiguous legacy histories", () => {
    const input = { ...context(), actuals: { gates: {}, events: [], launchDate: "2026-09-08" }, delay: delay() };
    input.delay.status = "completed";
    expect(decideProjectLaunch(input, { kind: "revoke", reason: "Legacy correction" }).kind).toBe("changed");
    input.delay.revisions = [];
    expect(decideProjectLaunch(input, { kind: "revoke", reason: "Legacy correction" })).toEqual({ kind: "rejected", reason: "history-incomplete" });
    expect(decideProjectLaunch(input, { kind: "correct", date: "2026-09-07", reason: "Deployment log" }).kind).toBe("changed");
    expect(projectLaunchState(input).acceptanceDate).toBeNull();
  });
});
