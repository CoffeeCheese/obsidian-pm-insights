import type {
  AcceptanceProgressMetric,
  StageProgressMetric
} from "./delivery-progress";
import type { GateRiskSnapshot } from "./gate-risk";

export type DeliveryScheduleState =
  | "ahead"
  | "behind"
  | "on-plan"
  | "unconfigured"
  | "unavailable";

export interface DeliveryScheduleComparison {
  expectedPercentage: number | null;
  variance: number | null;
  state: DeliveryScheduleState;
  relevantProjectCount: number;
  configuredProjectCount: number;
}

interface ProjectWeight {
  projectId: string;
  weight: number;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function projectWeights(projectIds: string[]): ProjectWeight[] {
  const counts = new Map<string, number>();
  for (const projectId of projectIds) {
    counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
  }
  return [...counts].map(([projectId, weight]) => ({ projectId, weight }));
}

function compareSchedule(
  risk: GateRiskSnapshot,
  weights: ProjectWeight[],
  gateId: string,
  kind: "stage" | "acceptance",
  actualPercentage: number | null
): DeliveryScheduleComparison {
  if (actualPercentage === null || weights.length === 0) {
    return {
      expectedPercentage: null,
      variance: null,
      state: "unavailable",
      relevantProjectCount: weights.length,
      configuredProjectCount: 0
    };
  }

  let configuredProjectCount = 0;
  let weightedExpected = 0;
  let totalWeight = 0;
  for (const projectWeight of weights) {
    const project = risk.projects.find(
      (candidate) => candidate.project.id === projectWeight.projectId
    );
    const gate = project?.configured
      ? project.gates.find((candidate) => candidate.id === gateId && candidate.kind === kind)
      : undefined;
    if (!gate || gate.expectedProgress === null) continue;
    configuredProjectCount += 1;
    weightedExpected += gate.expectedProgress * projectWeight.weight;
    totalWeight += projectWeight.weight;
  }

  if (configuredProjectCount !== weights.length || totalWeight === 0) {
    return {
      expectedPercentage: null,
      variance: null,
      state: "unconfigured",
      relevantProjectCount: weights.length,
      configuredProjectCount
    };
  }

  const expectedPercentage = round(weightedExpected / totalWeight);
  const variance = round(actualPercentage - expectedPercentage);
  return {
    expectedPercentage,
    variance,
    state: variance > 0 ? "ahead" : variance < 0 ? "behind" : "on-plan",
    relevantProjectCount: weights.length,
    configuredProjectCount
  };
}

export function compareStageSchedule(
  metric: StageProgressMetric,
  risk: GateRiskSnapshot
): DeliveryScheduleComparison {
  return compareSchedule(
    risk,
    projectWeights(metric.tasks.map((task) => task.projectId)),
    metric.id,
    "stage",
    metric.percentage
  );
}

export function compareAcceptanceSchedule(
  metric: AcceptanceProgressMetric,
  risk: GateRiskSnapshot
): DeliveryScheduleComparison {
  return compareSchedule(
    risk,
    projectWeights(metric.roots.map((root) => root.task.projectId)),
    "acceptance",
    "acceptance",
    metric.percentage
  );
}
