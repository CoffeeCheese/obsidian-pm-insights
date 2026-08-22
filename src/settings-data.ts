import {
  DEFAULT_SETTINGS,
  type DeliveryProgressSettings,
  type DeliveryStageId,
  type InsightSettings
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
    deliveryProgress: normalizeDeliveryProgressSettings(saved?.deliveryProgress)
  };
}

function normalizeDeliveryProgressSettings(
  saved: Partial<DeliveryProgressSettings> | undefined
): DeliveryProgressSettings {
  const defaults = structuredClone(DEFAULT_SETTINGS.deliveryProgress);
  const stageIds: DeliveryStageId[] = ["design", "development", "testing"];
  for (const stageId of stageIds) {
    const candidate = saved?.stages?.[stageId];
    if (!candidate) continue;
    defaults.stages[stageId] = {
      ...defaults.stages[stageId],
      ...candidate,
      tags: Array.isArray(candidate.tags)
        ? candidate.tags.filter((tag): tag is string => typeof tag === "string")
        : defaults.stages[stageId].tags,
      weight: typeof candidate.weight === "number" && Number.isFinite(candidate.weight)
        ? candidate.weight
        : defaults.stages[stageId].weight,
      acceptancePrerequisite: typeof candidate.acceptancePrerequisite === "boolean"
        ? candidate.acceptancePrerequisite
        : defaults.stages[stageId].acceptancePrerequisite,
      skipWhenEmpty: typeof candidate.skipWhenEmpty === "boolean"
        ? candidate.skipWhenEmpty
        : defaults.stages[stageId].skipWhenEmpty
    };
  }
  if (typeof saved?.acceptanceWeight === "number" && Number.isFinite(saved.acceptanceWeight)) {
    defaults.acceptanceWeight = saved.acceptanceWeight;
  }
  return defaults;
}
