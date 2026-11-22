import type { ModelId, ModelRole, SpeakerModelId } from "../../shared/contracts/models.ts";
import { maxSpeakers } from "../../shared/contracts/transcriptions.ts";
import type { DownloadSource } from "../files/download.ts";

export interface ModelFile extends DownloadSource {
  repository: string;
  revision: string;
  filename: string;
  ggufArchitecture?: string;
}

type ModelFileRole = "transcription" | "diarization" | "segmentation" | "embedding";
export type ModelPaths = Partial<Record<ModelFileRole, string>>;

export interface ModelDefinition {
  id: ModelId;
  role: ModelRole;
  name: string;
  description: string;
  sourceUrl: string;
  license: string;
  languages: string[];
  maxSpeakers?: number;
  files: Readonly<Partial<Record<ModelFileRole, ModelFile>>>;
}

interface SpeakerModelDefinition extends ModelDefinition {
  id: SpeakerModelId;
  role: "speakers";
  maxSpeakers: number;
}

const huggingFaceFile = (file: Omit<ModelFile, "url">): ModelFile => ({
  ...file,
  url: `https://huggingface.co/${file.repository}/resolve/${file.revision}/${file.filename}`,
});

const parakeetFile = huggingFaceFile({
  repository: "handy-computer/parakeet-ultra-gguf",
  revision: "39eeb55181f0d354fd934f06e92fd8d5037fed8e",
  filename: "parakeet-ultra-Q8_0.gguf",
  bytes: 740363168,
  sha256: "007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59",
  ggufArchitecture: "parakeet",
});

export const transcriptionModel = {
  id: "parakeet-ultra-q8",
  role: "transcription",
  name: "Parakeet Ultra",
  description: "25 European languages, including Polish and English",
  sourceUrl: `https://huggingface.co/${parakeetFile.repository}/tree/${parakeetFile.revision}`,
  files: { transcription: parakeetFile },
  license: "CC BY 4.0",
  languages: [
    "en",
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "ru",
    "uk",
    "hr",
    "sl",
    "lv",
    "lt",
    "et",
    "fi",
    "sv",
    "da",
    "nl",
    "pl",
    "cs",
    "sk",
    "hu",
    "ro",
    "bg",
    "el",
    "mt",
  ],
} satisfies ModelDefinition;

const sortformerFile = huggingFaceFile({
  repository: "handy-computer/diar_streaming_sortformer_4spk-v2.1-gguf",
  revision: "60ebab3ef7cae9869be0abcde13360347e96ba03",
  filename: "diar_streaming_sortformer_4spk-v2.1-Q8_0.gguf",
  bytes: 139310336,
  sha256: "a5dacdc650790266c7a362e54e6bf51952015487edaa606c4e11632bc32442a9",
  ggufArchitecture: "sortformer",
});

export const sortformerModel = {
  id: "sortformer-4spk-q8",
  role: "speakers",
  name: "Sortformer",
  description: "Fast, for interviews and podcasts",
  sourceUrl: `https://huggingface.co/${sortformerFile.repository}/tree/${sortformerFile.revision}`,
  files: { diarization: sortformerFile },
  license: "NVIDIA Open Model License",
  languages: ["en"],
  maxSpeakers: 4,
} satisfies SpeakerModelDefinition;

export const pyannoteModel = {
  id: "pyannote-wespeaker",
  role: "speakers",
  name: "Pyannote + WeSpeaker",
  description: "Runs on the processor, for meetings and press conferences",
  sourceUrl: "https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html",
  files: {
    segmentation: huggingFaceFile({
      repository: "csukuangfj/sherpa-onnx-pyannote-segmentation-3-0",
      revision: "9403a6902bb58e3d5ae8c7e77c3422de279db2e0",
      filename: "model.onnx",
      bytes: 5992913,
      sha256: "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079",
    }),
    embedding: huggingFaceFile({
      repository: "csukuangfj/speaker-embedding-models",
      revision: "a8055d6daef723a6a4ecf4de233708575bf4994f",
      filename: "wespeaker_en_voxceleb_resnet34_LM.onnx",
      bytes: 26530550,
      sha256: "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012",
    }),
  },
  license: "MIT and CC BY 4.0",
  languages: ["en"],
  maxSpeakers,
} satisfies SpeakerModelDefinition;

export const speakerModels = [sortformerModel, pyannoteModel];
export const modelCatalog = [transcriptionModel, ...speakerModels];
