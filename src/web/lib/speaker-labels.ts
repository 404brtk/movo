import type { ModelStatus } from "../../shared/contracts/models.ts";

export const speakerLabelsTitle = (model: Pick<ModelStatus, "maxSpeakers">) =>
  `Up to ${model.maxSpeakers} speakers`;
