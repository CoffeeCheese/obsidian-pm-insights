import type { GateRiskSnapshot } from "./gate-risk";
import { aggregateDeliveryProgress } from "./delivery-progress";
import type {
  DeliveryProgressSettings,
  MemberInsight,
  TaskInsight,
  TaskRecord
} from "../model";

export interface MemberProjectCommitment {
  projectId: string;
  projectTitle: string;
  stageId: string;
  stageName: string;
  deliveryDate: string;
  crossedStageIds: string[];
  taskKeys: string[];
}

export type UnresolvedCommitmentReason =
  | "unconfigured-project"
  | "unmapped-stage";

export interface UnresolvedMemberCommitment {
  projectId: string;
  taskKeys: string[];
  reason: UnresolvedCommitmentReason;
}

export interface MemberDeliveryPlan {
  commitments: MemberProjectCommitment[];
  unresolved: UnresolvedMemberCommitment[];
}

interface StageReference {
  id: string;
  name: string;
  date: string;
  order: number;
}

function taskKey(task: Pick<TaskRecord, "projectId" | "id">): string {
  return `${task.projectId}\u0000${task.id}`;
}

function addStageReference(
  stagesByTask: Map<string, Map<string, StageReference>>,
  key: string,
  stage: StageReference
): void {
  let stages = stagesByTask.get(key);
  if (!stages) {
    stages = new Map();
    stagesByTask.set(key, stages);
  }
  stages.set(stage.id, stage);
}

function indexTaskStages(
  allTasks: readonly TaskRecord[],
  gateRisk: GateRiskSnapshot,
  deliveryProgressSettings: DeliveryProgressSettings,
  includeArchived: boolean
): Map<string, Map<string, StageReference>> {
  const tasksByKey = new Map(allTasks.map((task) => [taskKey(task), task]));
  const tasksByProject = new Map<string, TaskRecord[]>();
  for (const task of allTasks) {
    const tasks = tasksByProject.get(task.projectId) ?? [];
    tasks.push(task);
    tasksByProject.set(task.projectId, tasks);
  }
  const stagesByTask = new Map<string, Map<string, StageReference>>();

  for (const project of gateRisk.projects) {
    const stages = project.gates.filter((gate) => gate.kind === "stage");
    const classifiedStages = new Map(aggregateDeliveryProgress(
      tasksByProject.get(project.project.id) ?? [],
      {
        projectIds: new Set([project.project.id]),
        includeArchived,
        settings: deliveryProgressSettings
      }
    ).stages.map((stage) => [stage.id, stage.tasks]));
    stages.forEach((gate, order) => {
      const stage: StageReference = {
        id: gate.id,
        name: gate.name,
        date: gate.gateDate,
        order
      };
      const stageTasks = new Map([
        ...(classifiedStages.get(gate.id) ?? []),
        ...gate.tasks
      ].map((task) => [taskKey(task), task]));
      for (const stageTask of stageTasks.values()) {
        let current: TaskRecord | undefined = tasksByKey.get(taskKey(stageTask)) ?? stageTask;
        const seen = new Set<string>();
        while (current) {
          const currentKey = taskKey(current);
          if (seen.has(currentKey)) break;
          seen.add(currentKey);
          addStageReference(stagesByTask, currentKey, stage);
          current = current.parentId
            ? tasksByKey.get(`${current.projectId}\u0000${current.parentId}`)
            : undefined;
        }
      }
    });
  }

  return stagesByTask;
}

function resolveMemberDeliveryPlan(
  memberTasks: readonly TaskInsight[],
  stagesByTask: Map<string, Map<string, StageReference>>,
  gateRisk: GateRiskSnapshot
): MemberDeliveryPlan {
  const projectsById = new Map(gateRisk.projects.map((project) => [
    project.project.id,
    project
  ]));
  const tasksByProject = new Map<string, TaskInsight[]>();
  for (const task of memberTasks) {
    const tasks = tasksByProject.get(task.projectId) ?? [];
    tasks.push(task);
    tasksByProject.set(task.projectId, tasks);
  }

  const commitments: MemberProjectCommitment[] = [];
  const unresolved: UnresolvedMemberCommitment[] = [];
  for (const [projectId, projectTasks] of tasksByProject) {
    const project = projectsById.get(projectId);
    if (!project?.configured) {
      unresolved.push({
        projectId,
        taskKeys: projectTasks.map(taskKey),
        reason: "unconfigured-project"
      });
      continue;
    }

    const resolvedTaskKeys: string[] = [];
    const unresolvedTaskKeys: string[] = [];
    const projectStages = new Map<string, StageReference>();
    for (const task of projectTasks) {
      const stages = stagesByTask.get(taskKey(task));
      if (!stages || stages.size === 0) {
        unresolvedTaskKeys.push(taskKey(task));
        continue;
      }
      resolvedTaskKeys.push(taskKey(task));
      for (const stage of stages.values()) projectStages.set(stage.id, stage);
    }

    if (unresolvedTaskKeys.length > 0) {
      unresolved.push({
        projectId,
        taskKeys: unresolvedTaskKeys,
        reason: "unmapped-stage"
      });
    }
    if (resolvedTaskKeys.length === 0) continue;

    const orderedStages = [...projectStages.values()]
      .sort((left, right) => left.order - right.order);
    const farthest = orderedStages.at(-1);
    if (!farthest) continue;
    commitments.push({
      projectId,
      projectTitle: projectTasks[0]?.projectTitle ?? project.project.title,
      stageId: farthest.id,
      stageName: farthest.name,
      deliveryDate: farthest.date,
      crossedStageIds: orderedStages.map((stage) => stage.id),
      taskKeys: resolvedTaskKeys
    });
  }

  return { commitments, unresolved };
}

export function resolveMemberDeliveryCommitments(input: {
  members: readonly MemberInsight[];
  allTasks: readonly TaskRecord[];
  gateRisk: GateRiskSnapshot;
  deliveryProgressSettings: DeliveryProgressSettings;
  includeArchived: boolean;
}): Map<string, MemberDeliveryPlan> {
  const stagesByTask = indexTaskStages(
    input.allTasks,
    input.gateRisk,
    input.deliveryProgressSettings,
    input.includeArchived
  );
  return new Map(input.members.map((member) => [
    member.key,
    resolveMemberDeliveryPlan(member.tasks, stagesByTask, input.gateRisk)
  ]));
}
