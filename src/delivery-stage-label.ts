import type { Translations } from "./i18n";
import type { DeliveryStageId } from "./model";

export function deliveryStageLabel(
  stageId: DeliveryStageId,
  name: string,
  translations: Translations,
  fallbackToId = true
): string {
  if (name) return name;
  if (stageId === "design") return translations.designProgress;
  if (stageId === "development") return translations.developmentProgress;
  if (stageId === "testing") return translations.testingProgress;
  return fallbackToId ? stageId : "";
}
