import { parentPort, workerData } from "node:worker_threads";
import { diarizeSpeakers } from "./speaker-diarization.ts";

if (!parentPort) throw new Error("The speaker worker must be started by Movo.");
const {
  segmentationPath,
  embeddingPath,
  pcm,
}: {
  segmentationPath: string;
  embeddingPath: string;
  pcm: Uint8Array;
} = workerData;
parentPort.postMessage(await diarizeSpeakers(segmentationPath, embeddingPath, pcm), []);
