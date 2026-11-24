import { cpus } from "node:os";
import { Schema } from "effect";
import type { TranscribeModel } from "transcribe-cpp";
import { TranscriptionDevice } from "../../shared/contracts/transcriptions.ts";

export const modelDevice = (model: TranscribeModel) =>
  Schema.decodeUnknownSync(TranscriptionDevice)({
    backend: model.device.kind,
    name: model.device.description.trim() || model.device.name,
  });

export const processorDevice = () =>
  Schema.decodeUnknownSync(TranscriptionDevice)({
    backend: "cpu",
    name: cpus()[0]?.model.trim() || "Processor",
  });
