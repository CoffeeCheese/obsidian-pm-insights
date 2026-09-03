export interface ProjectRecord {
  id: string;
  title: string;
  path: string;
  icon: string;
}

export interface PriorityRecord {
  id: string;
  label: string;
  color: string;
}

export interface TimeLogRecord {
  hours: number;
}

export type TaskHierarchy = "root" | "subtask" | "unknown";

export interface TaskRecord {
  id: string;
  projectId: string;
  parentId: string | null;
  hierarchy: TaskHierarchy;
  title: string;
  path: string;
  status: string;
  priority: string | null;
  tags: string[];
  assignees: string[];
  estimate: number;
  logged: number;
  progress: number;
  completed: boolean;
  startDate?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  archived: boolean;
}

export interface MemberAlias {
  canonical: string;
  aliases: string[];
}

export type DeliveryStageId = string;

export interface DeliveryStageSettings {
  id: DeliveryStageId;
  name: string;
  tags: string[];
  weight: number;
  acceptancePrerequisite: boolean;
  skipWhenEmpty: boolean;
}

export interface DeliveryProgressSettings {
  stages: DeliveryStageSettings[];
  acceptanceWeight: number;
  validateCompletedRootPrerequisites: boolean;
}

export interface ProjectGateSchedule {
  startDate: string;
  stageGates: Record<DeliveryStageId, string>;
  acceptanceGate: string;
  launchDate: string;
  includeWeekends: boolean;
  countSameDayGateAsDay: boolean;
}

export interface ProjectGateForecast {
  stageGates: Record<DeliveryStageId, string>;
  acceptanceGate: string;
  launchDate: string;
}

export type GateDelayStatus =
  | "evaluating"
  | "confirmed"
  | "resolved"
  | "restored"
  | "withdrawn"
  | "completed";

export type GateDelayRevisionKind =
  | "evaluation"
  | "confirmed"
  | "resolved"
  | "restored"
  | "withdrawn";

export type GateDateChangeSource = "manual" | "linked" | "system";

export interface GateStageSnapshot {
  id: DeliveryStageId;
  name: string;
  order: number;
}

export interface GateDelayRevision {
  id: string;
  createdAt: string;
  decidedAt?: string;
  kind: GateDelayRevisionKind;
  reason: string;
  targetRevisionId?: string;
  withdrawnAt?: string;
  forecast: ProjectGateForecast;
  stages: GateStageSnapshot[];
  changes: Record<string, GateDateChangeSource>;
}

export interface ProjectGateDelayPlan {
  status: GateDelayStatus;
  draft?: ProjectGateForecast;
  pendingEvaluationRevisionId?: string;
  confirmed?: ProjectGateForecast;
  confirmedRevisionId?: string;
  revisions: GateDelayRevision[];
}

export type GateActualDateSource = "tasks" | "observed" | "manual";

export interface GateActualPass {
  date: string;
  source: GateActualDateSource;
  recordedAt: string;
  open: boolean;
}

export type GateActualEventKind =
  | "passed"
  | "reopened"
  | "corrected"
  | "launch"
  | "launch-corrected";

export interface GateActualEvent {
  id: string;
  createdAt: string;
  kind: GateActualEventKind;
  gateId: string;
  date?: string;
  previousDate?: string;
  source?: GateActualDateSource;
  reason?: string;
}

export interface ProjectGateActualState {
  gates: Record<string, GateActualPass>;
  launchDate?: string;
  launchRecordedAt?: string;
  events: GateActualEvent[];
}

export interface GateRiskSettings {
  checkTaskDueDates: boolean;
  workdayHours: number;
  calendarDayHours: number;
}

export type MemberDashboardWindowMode = "7" | "14" | "30" | "custom";

export interface MemberDashboardSettings {
  windowMode: MemberDashboardWindowMode;
  customEndDate: string;
  includeWeekends: boolean;
}

export interface InsightSettings {
  locale: "auto" | "en" | "zh-cn";
  aliases: MemberAlias[];
  selectedProjectIds: string[];
  includeArchived: boolean;
  countParentTasks: boolean;
  showDeliveryProgress: boolean;
  deliveryProgress: DeliveryProgressSettings;
  gateRisk: GateRiskSettings;
  memberDashboard: MemberDashboardSettings;
  gateSchedules: Record<string, ProjectGateSchedule>;
  gateDelays: Record<string, ProjectGateDelayPlan>;
  gateActuals: Record<string, ProjectGateActualState>;
}

export interface WorkMetrics {
  planned: number;
  logged: number;
  remaining: number;
  overrun: number;
  taskCount: number;
  unestimatedCount: number;
}

export interface RatioMetric {
  numerator: number;
  denominator: number;
  percentage: number | null;
}

export interface MemberRatios {
  taskClosure: RatioMetric;
  plannedClosure: RatioMetric;
  timeConsumption: RatioMetric;
  overrunTasks: RatioMetric;
  estimateAccuracy: RatioMetric;
  estimateCoverage: RatioMetric;
}

export type AssignmentKind = "personal" | "shared" | "unassigned";

export interface TaskInsight extends TaskRecord {
  projectTitle: string;
  resolvedAssignees: string[];
  assignmentKind: AssignmentKind;
  remaining: number;
  overrun: number;
  unestimated: boolean;
}

export interface MemberInsight {
  key: string;
  name: string;
  kind: "member" | "unassigned";
  personal: WorkMetrics;
  shared: WorkMetrics;
  ratios: MemberRatios;
  tasks: TaskInsight[];
}

export interface DataQualitySummary {
  subtaskCount: number;
  parentTaskCount: number;
  unassignedCount: number;
  unestimatedCount: number;
  excludedParentCount: number;
  excludedChildTaskCount: number;
  excludedParentHours: number;
}

export interface InsightSnapshot {
  members: MemberInsight[];
  tasks: TaskInsight[];
  team: WorkMetrics;
  quality: DataQualitySummary;
}

export const DEFAULT_SETTINGS: InsightSettings = {
  locale: "auto",
  aliases: [],
  selectedProjectIds: [],
  includeArchived: false,
  countParentTasks: false,
  showDeliveryProgress: true,
  gateRisk: {
    checkTaskDueDates: true,
    workdayHours: 8,
    calendarDayHours: 8
  },
  memberDashboard: {
    windowMode: "14",
    customEndDate: "",
    includeWeekends: false
  },
  gateSchedules: {},
  gateDelays: {},
  gateActuals: {},
  deliveryProgress: {
    stages: [
      {
        id: "design",
        name: "",
        tags: ["type/design"],
        weight: 10,
        acceptancePrerequisite: false,
        skipWhenEmpty: true
      },
      {
        id: "development",
        name: "",
        tags: ["type/dev"],
        weight: 50,
        acceptancePrerequisite: true,
        skipWhenEmpty: false
      },
      {
        id: "testing",
        name: "",
        tags: ["type/test"],
        weight: 30,
        acceptancePrerequisite: true,
        skipWhenEmpty: true
      }
    ],
    acceptanceWeight: 10,
    validateCompletedRootPrerequisites: true
  }
};
