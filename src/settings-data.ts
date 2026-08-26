import {
  DEFAULT_SETTINGS,
  type DeliveryProgressSettings,
  type DeliveryStageSettings,
  type GateActualDateSource,
  type GateActualEvent,
  type GateActualEventKind,
  type GateDateChangeSource,
  type GateDelayRevision,
  type GateDelayRevisionKind,
  type GateDelayStatus,
  type GateRiskSettings,
  type InsightSettings,
  type ProjectGateActualState,
  type ProjectGateDelayPlan,
  type ProjectGateForecast,
  type ProjectGateSchedule
} from "./model";

export function normalizeInsightSettings(
  saved: Partial<InsightSettings> | null
): InsightSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...saved,
    aliases: Array.isArray(saved?.aliases) ? saved.aliases : [],
    selectedProjectIds: Array.isArray(saved?.selectedProjectIds) ? saved.selectedProjectIds : [],
    showDeliveryProgress: typeof saved?.showDeliveryProgress === "boolean"
      ? saved.showDeliveryProgress
      : DEFAULT_SETTINGS.showDeliveryProgress,
    deliveryProgress: normalizeDeliveryProgressSettings(saved?.deliveryProgress),
    gateRisk: normalizeGateRiskSettings(saved?.gateRisk),
    gateSchedules: normalizeGateSchedules(saved?.gateSchedules),
    gateDelays: normalizeGateDelays(saved?.gateDelays),
    gateActuals: normalizeGateActuals(saved?.gateActuals)
  };
}

function normalizeGateRiskSettings(
  saved: Partial<GateRiskSettings> | undefined
): GateRiskSettings {
  return {
    checkTaskDueDates: typeof saved?.checkTaskDueDates === "boolean"
      ? saved.checkTaskDueDates
      : DEFAULT_SETTINGS.gateRisk.checkTaskDueDates
  };
}

function normalizeGateSchedules(value: unknown): Record<string, ProjectGateSchedule> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([projectId, candidate]) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const raw = candidate as Partial<ProjectGateSchedule>;
    const stageGates = raw.stageGates && typeof raw.stageGates === "object"
      ? Object.fromEntries(Object.entries(raw.stageGates).flatMap(([stageId, date]) =>
          typeof date === "string" ? [[stageId, date.trim()]] : []
        ))
      : {};
    return [[projectId, {
      startDate: typeof raw.startDate === "string" ? raw.startDate.trim() : "",
      stageGates,
      acceptanceGate: typeof raw.acceptanceGate === "string" ? raw.acceptanceGate.trim() : "",
      launchDate: typeof raw.launchDate === "string" ? raw.launchDate.trim() : "",
      // Existing gate schedules have always used calendar days. Preserve that
      // calculation until a user explicitly enables the workday-only clock.
      includeWeekends: typeof raw.includeWeekends === "boolean" ? raw.includeWeekends : true
    } satisfies ProjectGateSchedule]];
  }));
}

const DELAY_STATUSES = new Set<GateDelayStatus>([
  "evaluating",
  "confirmed",
  "resolved",
  "restored",
  "withdrawn",
  "completed"
]);
const REVISION_KINDS = new Set<GateDelayRevisionKind>([
  "evaluation",
  "confirmed",
  "resolved",
  "restored",
  "withdrawn"
]);
const CHANGE_SOURCES = new Set<GateDateChangeSource>(["manual", "linked", "system"]);
const ACTUAL_SOURCES = new Set<GateActualDateSource>(["tasks", "observed", "manual"]);
const ACTUAL_EVENT_KINDS = new Set<GateActualEventKind>([
  "passed",
  "reopened",
  "corrected",
  "launch",
  "launch-corrected"
]);

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, candidate]) =>
    typeof candidate === "string" ? [[key, candidate.trim()]] : []
  ));
}

function normalizeForecast(value: unknown): ProjectGateForecast | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<ProjectGateForecast>;
  return {
    stageGates: stringRecord(raw.stageGates),
    acceptanceGate: typeof raw.acceptanceGate === "string" ? raw.acceptanceGate.trim() : "",
    launchDate: typeof raw.launchDate === "string" ? raw.launchDate.trim() : ""
  };
}

function normalizeRevision(value: unknown): GateDelayRevision | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<GateDelayRevision>;
  const forecast = normalizeForecast(raw.forecast);
  if (!forecast || typeof raw.id !== "string" || typeof raw.createdAt !== "string"
      || !REVISION_KINDS.has(raw.kind as GateDelayRevisionKind)) return undefined;
  const stages = Array.isArray(raw.stages)
    ? raw.stages.flatMap((candidate, order) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
        const stage = candidate as { id?: unknown; name?: unknown; order?: unknown };
        if (typeof stage.id !== "string" || !stage.id.trim()) return [];
        return [{
          id: stage.id.trim(),
          name: typeof stage.name === "string" ? stage.name.trim() : "",
          order: typeof stage.order === "number" && Number.isFinite(stage.order)
            ? stage.order
            : order
        }];
      })
    : [];
  const changes = Object.fromEntries(Object.entries(raw.changes ?? {}).flatMap(([key, source]) =>
    CHANGE_SOURCES.has(source)
      ? [[key, source]]
      : []
  ));
  const targetRevisionId = typeof raw.targetRevisionId === "string"
    ? raw.targetRevisionId.trim()
    : "";
  const decidedAt = typeof raw.decidedAt === "string" ? raw.decidedAt.trim() : "";
  const withdrawnAt = typeof raw.withdrawnAt === "string" ? raw.withdrawnAt.trim() : "";
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    ...(decidedAt ? { decidedAt } : {}),
    kind: raw.kind as GateDelayRevisionKind,
    reason: typeof raw.reason === "string" ? raw.reason.trim() : "",
    ...(targetRevisionId ? { targetRevisionId } : {}),
    ...(withdrawnAt ? { withdrawnAt } : {}),
    forecast,
    stages,
    changes
  };
}

function normalizeGateDelays(value: unknown): Record<string, ProjectGateDelayPlan> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([projectId, candidate]) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const raw = candidate as Partial<ProjectGateDelayPlan>;
    const revisions = Array.isArray(raw.revisions)
      ? raw.revisions.flatMap((revision) => normalizeRevision(revision) ?? [])
      : [];
    const status = DELAY_STATUSES.has(raw.status as GateDelayStatus)
      ? raw.status as GateDelayStatus
      : revisions.length > 0
        ? "resolved"
        : "evaluating";
    const draft = normalizeForecast(raw.draft);
    const confirmed = normalizeForecast(raw.confirmed);
    const confirmedRevisionId = typeof raw.confirmedRevisionId === "string"
      ? raw.confirmedRevisionId
      : undefined;
    const explicitPendingId = typeof raw.pendingEvaluationRevisionId === "string"
      ? raw.pendingEvaluationRevisionId
      : undefined;
    const withdrawnRevisionIds = new Set(revisions.flatMap((revision) => {
      if (revision.withdrawnAt) return [revision.id];
      if (revision.kind === "withdrawn" && revision.targetRevisionId) {
        return [revision.targetRevisionId];
      }
      return [];
    }));
    const inferredPendingId = (() => {
      for (let index = revisions.length - 1; index >= 0; index -= 1) {
        const revision = revisions[index];
        if (!revision || revision.kind === "withdrawn"
            || withdrawnRevisionIds.has(revision.id)) continue;
        if (revision.kind === "evaluation") return revision.id;
        if (["confirmed", "resolved", "restored"].includes(revision.kind)) return undefined;
      }
      return undefined;
    })();
    const pendingEvaluationRevisionId = status === "evaluating" && draft
      ? revisions.find((revision) =>
          revision.id === explicitPendingId
            && revision.kind === "evaluation"
            && !withdrawnRevisionIds.has(revision.id)
        )?.id ?? inferredPendingId
      : undefined;
    return [[projectId, {
      status,
      revisions,
      ...(draft ? { draft } : {}),
      ...(pendingEvaluationRevisionId ? { pendingEvaluationRevisionId } : {}),
      ...(confirmed ? { confirmed } : {}),
      ...(confirmedRevisionId ? { confirmedRevisionId } : {})
    } satisfies ProjectGateDelayPlan]];
  }));
}

function normalizeActualEvent(value: unknown): GateActualEvent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<GateActualEvent>;
  if (typeof raw.id !== "string" || typeof raw.createdAt !== "string"
      || typeof raw.gateId !== "string"
      || !ACTUAL_EVENT_KINDS.has(raw.kind as GateActualEventKind)) return undefined;
  const date = typeof raw.date === "string" ? raw.date.trim() : undefined;
  const previousDate = typeof raw.previousDate === "string"
    ? raw.previousDate.trim()
    : undefined;
  const source = ACTUAL_SOURCES.has(raw.source as GateActualDateSource)
    ? raw.source as GateActualDateSource
    : undefined;
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : undefined;
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    kind: raw.kind as GateActualEventKind,
    gateId: raw.gateId,
    ...(date ? { date } : {}),
    ...(previousDate ? { previousDate } : {}),
    ...(source ? { source } : {}),
    ...(reason ? { reason } : {})
  };
}

function normalizeGateActuals(value: unknown): Record<string, ProjectGateActualState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([projectId, candidate]) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const raw = candidate as Partial<ProjectGateActualState>;
    const gates = raw.gates && typeof raw.gates === "object" && !Array.isArray(raw.gates)
      ? Object.fromEntries(Object.entries(raw.gates).flatMap(([gateId, value]) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return [];
          const pass = value as { date?: unknown; source?: unknown; recordedAt?: unknown; open?: unknown };
          if (typeof pass.date !== "string" || typeof pass.recordedAt !== "string") return [];
          const source = ACTUAL_SOURCES.has(pass.source as GateActualDateSource)
            ? pass.source as GateActualDateSource
            : "observed";
          return [[gateId, {
            date: pass.date.trim(),
            source,
            recordedAt: pass.recordedAt,
            open: pass.open === true
          }]];
        }))
      : {};
    const launchDate = typeof raw.launchDate === "string" ? raw.launchDate.trim() : undefined;
    const launchRecordedAt = typeof raw.launchRecordedAt === "string"
      ? raw.launchRecordedAt
      : undefined;
    return [[projectId, {
      gates,
      events: Array.isArray(raw.events)
        ? raw.events.flatMap((event) => normalizeActualEvent(event) ?? [])
        : [],
      ...(launchDate ? { launchDate } : {}),
      ...(launchRecordedAt ? { launchRecordedAt } : {})
    } satisfies ProjectGateActualState]];
  }));
}

function normalizeDeliveryProgressSettings(
  saved: Partial<DeliveryProgressSettings> | undefined
): DeliveryProgressSettings {
  const defaults = structuredClone(DEFAULT_SETTINGS.deliveryProgress);
  const rawStages = saved?.stages as unknown;
  if (Array.isArray(rawStages)) {
    const normalized = rawStages.flatMap((candidate, index) => {
      const fallback = defaults.stages[index] ?? defaults.stages[0];
      const stage = normalizeStage(candidate, fallback);
      return stage ? [stage] : [];
    });
    if (normalized.length > 0) defaults.stages = normalized.slice(0, 8);
  } else if (rawStages && typeof rawStages === "object") {
    defaults.stages = defaults.stages.map((fallback) => {
      const candidate = (rawStages as Record<string, unknown>)[fallback.id];
      return normalizeStage(candidate, fallback) ?? fallback;
    });
  }
  if (typeof saved?.acceptanceWeight === "number" && Number.isFinite(saved.acceptanceWeight)) {
    defaults.acceptanceWeight = saved.acceptanceWeight;
  }
  if (typeof saved?.validateCompletedRootPrerequisites === "boolean") {
    defaults.validateCompletedRootPrerequisites = saved.validateCompletedRootPrerequisites;
  }
  return defaults;
}

function normalizeStage(
  value: unknown,
  fallback: DeliveryStageSettings | undefined
): DeliveryStageSettings | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DeliveryStageSettings>;
  const id = typeof candidate.id === "string" && candidate.id.trim()
    ? candidate.id.trim()
    : fallback?.id ?? "";
  if (!id) return null;
  return {
    id,
    name: typeof candidate.name === "string" ? candidate.name.trim() : fallback?.name ?? "",
    tags: Array.isArray(candidate.tags)
      ? candidate.tags.filter((tag): tag is string => typeof tag === "string")
      : fallback?.tags ?? [],
    weight: typeof candidate.weight === "number" && Number.isFinite(candidate.weight)
      ? candidate.weight
      : fallback?.weight ?? 0,
    acceptancePrerequisite: typeof candidate.acceptancePrerequisite === "boolean"
      ? candidate.acceptancePrerequisite
      : fallback?.acceptancePrerequisite ?? false,
    skipWhenEmpty: typeof candidate.skipWhenEmpty === "boolean"
      ? candidate.skipWhenEmpty
      : fallback?.skipWhenEmpty ?? false
  };
}
