import {
  DEFAULT_SETTINGS,
  type DeliveryProgressSettings,
  type DeliveryStageSettings,
  type InsightSettings,
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
    gateSchedules: normalizeGateSchedules(saved?.gateSchedules)
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
      launchDate: typeof raw.launchDate === "string" ? raw.launchDate.trim() : ""
    } satisfies ProjectGateSchedule]];
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
