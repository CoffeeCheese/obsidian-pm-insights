import { IdentityResolver } from "./identity";
import { scheduleDaysBetween } from "./schedule-calendar";
import type { MemberAlias, TaskRecord } from "../model";

export type LaunchCapacityState = "normal" | "attention" | "high" | "overdue" | "passed";

export interface LaunchCapacityOwnerLoad {
  name: string;
  hours: number;
}

export interface LaunchCapacityCheckpoint {
  id: string;
  name: string;
  kind: "stage" | "launch";
  gateDate: string;
  daysRemaining: number;
  remainingHours: number;
  availableHours: number;
  balanceHours: number;
  utilizationPercentage: number | null;
  bottleneckAssignee: string | null;
  bottleneckHours: number;
  owners: LaunchCapacityOwnerLoad[];
  state: Exclude<LaunchCapacityState, "passed">;
}

export interface LaunchCapacityStageInput {
  id: string;
  name: string;
  gateDate: string;
  tasks: TaskRecord[];
}

export interface LaunchCapacityInput {
  tasks: TaskRecord[];
  stages: LaunchCapacityStageInput[];
  today: string;
  launchDate: string;
  includeWeekends: boolean;
  hoursPerDay: number;
  aliases: MemberAlias[];
  passed: boolean;
}

export interface LaunchCapacityMetric {
  remainingHours: number;
  bottleneckAssignee: string | null;
  bottleneckHours: number;
  requiredDays: number;
  availableHours: number;
  balanceHours: number;
  utilizationPercentage: number | null;
  hoursPerDay: number;
  daysRemaining: number;
  checkpointId: string;
  checkpointName: string;
  checkpointDate: string;
  unestimatedTaskCount: number;
  unassignedTaskCount: number;
  unassignedHours: number;
  unmappedTaskCount: number;
  sharedTaskCount: number;
  checkpoints: LaunchCapacityCheckpoint[];
  state: LaunchCapacityState;
}

const ATTENTION_THRESHOLD = 80;

const STATE_SEVERITY: Record<Exclude<LaunchCapacityState, "passed">, number> = {
  normal: 1,
  attention: 2,
  high: 3,
  overdue: 4
};

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function taskKey(task: Pick<TaskRecord, "projectId" | "id">): string {
  return `${task.projectId}\u0000${task.id}`;
}

function isCancelled(task: TaskRecord): boolean {
  const status = task.status.trim().toLocaleLowerCase();
  return status === "cancelled" || status === "canceled";
}

function executableTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...new Map(tasks.map((task) => [taskKey(task), task])).values()].filter(
    (task) => !task.completed && !task.archived && !isCancelled(task)
  );
}

function checkpointState(
  daysRemaining: number,
  bottleneckHours: number,
  availableHours: number,
  utilizationPercentage: number | null
): LaunchCapacityCheckpoint["state"] {
  if (daysRemaining < 0 && bottleneckHours > 0) return "overdue";
  if (bottleneckHours > availableHours) return "high";
  if ((utilizationPercentage ?? 0) >= ATTENTION_THRESHOLD) return "attention";
  return "normal";
}

export function assessLaunchCapacity(input: LaunchCapacityInput): LaunchCapacityMetric {
  const executable = executableTasks(input.tasks);
  const resolver = new IdentityResolver(input.aliases);
  const stageIndexByTask = new Map<string, number>();
  input.stages.forEach((stage, index) => {
    for (const task of stage.tasks) stageIndexByTask.set(taskKey(task), index);
  });

  const estimated = executable.filter((task) => task.estimate > 0);
  const remainingByTask = new Map(estimated.map((task) => [
    taskKey(task),
    Math.max(task.estimate - task.logged, 0)
  ]));
  const remainingHours = round([...remainingByTask.values()].reduce(
    (total, remaining) => total + remaining,
    0
  ));
  const unestimatedTaskCount = executable.length - estimated.length;
  const unassignedTasks = estimated.filter((task) =>
    (remainingByTask.get(taskKey(task)) ?? 0) > 0
      && resolver.resolveMany(task.assignees).length === 0
  );
  const unassignedTaskCount = unassignedTasks.length;
  const unassignedHours = round(unassignedTasks.reduce(
    (total, task) => total + (remainingByTask.get(taskKey(task)) ?? 0),
    0
  ));
  const unmappedTaskCount = executable.filter((task) =>
    task.hierarchy !== "root" && !stageIndexByTask.has(taskKey(task))
  ).length;
  const sharedTaskCount = estimated.filter((task) =>
    (remainingByTask.get(taskKey(task)) ?? 0) > 0
      && resolver.resolveMany(task.assignees).length > 1
  ).length;

  const checkpointInputs = [
    ...input.stages.map((stage, index) => ({
      id: stage.id,
      name: stage.name,
      kind: "stage" as const,
      gateDate: stage.gateDate,
      index
    })),
    {
      id: "launch",
      name: "",
      kind: "launch" as const,
      gateDate: input.launchDate,
      index: input.stages.length
    }
  ];

  const checkpoints = checkpointInputs.map((checkpoint): LaunchCapacityCheckpoint => {
    const ownerHours = new Map<string, number>();
    let checkpointRemaining = 0;
    for (const task of estimated) {
      const remaining = remainingByTask.get(taskKey(task)) ?? 0;
      const deadlineIndex = stageIndexByTask.get(taskKey(task)) ?? input.stages.length;
      if (remaining <= 0 || deadlineIndex > checkpoint.index) continue;
      checkpointRemaining += remaining;
      const assignees = resolver.resolveMany(task.assignees);
      if (assignees.length === 0) continue;
      const allocation = remaining / assignees.length;
      for (const assignee of assignees) {
        ownerHours.set(assignee, (ownerHours.get(assignee) ?? 0) + allocation);
      }
    }

    const owners = [...ownerHours.entries()]
      .map(([name, hours]) => ({ name, hours: round(hours) }))
      .sort((left, right) => right.hours - left.hours || left.name.localeCompare(right.name));
    const bottleneck = owners[0] ?? null;
    const bottleneckHours = bottleneck?.hours ?? 0;
    const daysRemaining = scheduleDaysBetween(
      input.today,
      checkpoint.gateDate,
      input.includeWeekends
    );
    const availableHours = round(Math.max(daysRemaining, 0) * input.hoursPerDay);
    const balanceHours = round(availableHours - bottleneckHours);
    const utilizationPercentage = availableHours > 0
      ? round((bottleneckHours / availableHours) * 100)
      : bottleneckHours > 0
        ? null
        : 0;

    return {
      id: checkpoint.id,
      name: checkpoint.name,
      kind: checkpoint.kind,
      gateDate: checkpoint.gateDate,
      daysRemaining,
      remainingHours: round(checkpointRemaining),
      availableHours,
      balanceHours,
      utilizationPercentage,
      bottleneckAssignee: bottleneck?.name ?? null,
      bottleneckHours,
      owners,
      state: checkpointState(
        daysRemaining,
        bottleneckHours,
        availableHours,
        utilizationPercentage
      )
    };
  });

  const critical = checkpoints.reduce((worst, checkpoint) => {
    const severity = STATE_SEVERITY[checkpoint.state];
    const worstSeverity = STATE_SEVERITY[worst.state];
    if (severity !== worstSeverity) return severity > worstSeverity ? checkpoint : worst;
    return (checkpoint.utilizationPercentage ?? 0) > (worst.utilizationPercentage ?? 0)
      ? checkpoint
      : worst;
  }, checkpoints.at(-1)!);
  const hasPlanningBlindSpot = unestimatedTaskCount > 0
    || unassignedTaskCount > 0
    || unmappedTaskCount > 0;
  const state: LaunchCapacityState = input.passed
    ? "passed"
    : critical.state === "normal" && hasPlanningBlindSpot
      ? "attention"
      : critical.state;

  return {
    remainingHours,
    bottleneckAssignee: critical.bottleneckAssignee,
    bottleneckHours: critical.bottleneckHours,
    requiredDays: input.hoursPerDay > 0
      ? round(critical.bottleneckHours / input.hoursPerDay)
      : 0,
    availableHours: critical.availableHours,
    balanceHours: critical.balanceHours,
    utilizationPercentage: critical.utilizationPercentage,
    hoursPerDay: input.hoursPerDay,
    daysRemaining: critical.daysRemaining,
    checkpointId: critical.id,
    checkpointName: critical.name,
    checkpointDate: critical.gateDate,
    unestimatedTaskCount,
    unassignedTaskCount,
    unassignedHours,
    unmappedTaskCount,
    sharedTaskCount,
    checkpoints,
    state
  };
}
