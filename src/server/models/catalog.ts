import type { ModelId, ModelRole } from "../../shared/contracts/models.ts";
import type { DownloadSource } from "../files/download.ts";

export interface ModelDefinition extends DownloadSource {
  id: ModelId;
  role: ModelRole;
  architecture: string;
  repository: string;
  revision: string;
  filename: string;
  name: string;
  description: string;
  sourceUrl: string;
  license: string;
  languages: string[];
}

const repository = "handy-computer/parakeet-ultra-gguf";
const revision = "39eeb55181f0d354fd934f06e92fd8d5037fed8e";
const filename = "parakeet-ultra-Q8_0.gguf";

export const transcriptionModel: ModelDefinition = {
  id: "parakeet-ultra-q8",
  role: "transcription",
  architecture: "parakeet",
  repository,
  revision,
  filename,
  name: "Parakeet Ultra",
  description: "A local model for 25 European languages, including Polish and English.",
  sourceUrl: `https://huggingface.co/${repository}/tree/${revision}`,
  url: `https://huggingface.co/${repository}/resolve/${revision}/${filename}`,
  bytes: 740363168,
  sha256: "007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59",
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

const speakerRepository = "handy-computer/diar_streaming_sortformer_4spk-v2.1-gguf";
const speakerRevision = "60ebab3ef7cae9869be0abcde13360347e96ba03";
const speakerFilename = "diar_streaming_sortformer_4spk-v2.1-Q8_0.gguf";

export const speakerModel: ModelDefinition = {
  id: "sortformer-4spk-q8",
  role: "speakers",
  architecture: "sortformer",
  repository: speakerRepository,
  revision: speakerRevision,
  filename: speakerFilename,
  name: "Sortformer Speakers",
  description:
    "An optional local model that labels who speaks when, for up to four speakers. Trained mainly on English speech.",
  sourceUrl: `https://huggingface.co/${speakerRepository}/tree/${speakerRevision}`,
  url: `https://huggingface.co/${speakerRepository}/resolve/${speakerRevision}/${speakerFilename}`,
  bytes: 139310336,
  sha256: "a5dacdc650790266c7a362e54e6bf51952015487edaa606c4e11632bc32442a9",
  license: "NVIDIA Open Model License",
  languages: ["en"],
};

export const modelCatalog = [transcriptionModel, speakerModel];
