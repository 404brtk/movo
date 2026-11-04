import type { ModelId } from "../../shared/contracts/models.ts";
import type { DownloadSource } from "../files/download.ts";

export interface ModelDefinition extends DownloadSource {
  id: ModelId;
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
