export interface ProjectRecord {
  id: string;
  title: string;
  path: string;
  icon: string;
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
  assignees: string[];
  estimate: number;
  logged: number;
  progress: number;
  completed: boolean;
  archived: boolean;
}

export interface MemberAlias {
  canonical: string;
  aliases: string[];
}

export interface InsightSettings {
  locale: "auto" | "en" | "zh-cn";
  aliases: MemberAlias[];
  selectedProjectIds: string[];
  includeArchived: boolean;
}

export interface WorkMetrics {
  planned: number;
  logged: number;
  remaining: number;
  overrun: number;
  taskCount: number;
  unestimatedCount: number;
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
  tasks: TaskInsight[];
}

export interface DataQualitySummary {
  unassignedCount: number;
  unestimatedCount: number;
  excludedParentCount: number;
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
  includeArchived: false
};
