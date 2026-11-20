import type { ModelId, ModelRole } from "../../shared/contracts/models.ts";
import type { DownloadSource } from "../files/download.ts";

export interface ModelFile extends DownloadSource {
  repository: string;
  revision: string;
  filename: string;
  ggufArchitecture?: string;
}

export interface ModelDefinition {
  id: ModelId;
  role: ModelRole;
  name: string;
  description: string;
  sourceUrl: string;
  license: string;
  languages: string[];
  files: readonly ModelFile[];
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

export const transcriptionModel: ModelDefinition = {
  id: "parakeet-ultra-q8",
  role: "transcription",
  name: "Parakeet Ultra",
  description: "25 European languages, including Polish and English",
  sourceUrl: `https://huggingface.co/${parakeetFile.repository}/tree/${parakeetFile.revision}`,
  files: [parakeetFile],
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
};

export const speakerModel: ModelDefinition = {
  id: "pyannote-wespeaker",
  role: "speakers",
  name: "Pyannote",
  description: "Labels who speaks when and counts the speakers",
  sourceUrl: "https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html",
  files: [
    huggingFaceFile({
      repository: "csukuangfj/sherpa-onnx-pyannote-segmentation-3-0",
      revision: "9403a6902bb58e3d5ae8c7e77c3422de279db2e0",
      filename: "model.onnx",
      bytes: 5992913,
      sha256: "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079",
    }),
    huggingFaceFile({
      repository: "csukuangfj/speaker-embedding-models",
      revision: "a8055d6daef723a6a4ecf4de233708575bf4994f",
      filename: "wespeaker_en_voxceleb_resnet34_LM.onnx",
      bytes: 26530550,
      sha256: "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012",
    }),
  ],
  license: "MIT and CC BY 4.0",
  languages: ["en"],
};

export const modelCatalog = [transcriptionModel, speakerModel];
