# Local model setup

Model weights are optional. The library, imports and link downloads work without them. This feature manages model availability; transcription jobs and transcript presentation are separate product work.

## Supported models

The transcription model is **Parakeet Ultra Q8_0** (`parakeet-ultra-q8`).

- Upstream model: [Moondream Parakeet Ultra](https://huggingface.co/moondream/parakeet-ultra), post-trained from NVIDIA Parakeet v3.
- Converted weights: [Handy GGUF repository](https://huggingface.co/handy-computer/parakeet-ultra-gguf/tree/39eeb55181f0d354fd934f06e92fd8d5037fed8e).
- Revision: `39eeb55181f0d354fd934f06e92fd8d5037fed8e`.
- File: `parakeet-ultra-Q8_0.gguf`, exactly `740363168` bytes.
- SHA-256: `007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59`.
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); retain attribution to the upstream model and conversion publishers.

The optional speaker model is **Pyannote** (`pyannote-wespeaker`), shown in Settings as **Speaker labels** under Parakeet Ultra. When installed, it detects who speaks when and labels up to 32 speakers in each new transcript. The **Download model** action reports the combined size and progress of its two ONNX files.

If automatic detection finds more than 32 speaker groups, Movo repeats diarization with 32 groups and saves the transcript with those labels.

- Segmentation, which finds when someone speaks and where the speaker changes: [sherpa-onnx conversion](https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/tree/9403a6902bb58e3d5ae8c7e77c3422de279db2e0) of [pyannote segmentation 3.0](https://huggingface.co/pyannote/segmentation-3.0), file `model.onnx`, exactly `5992913` bytes, SHA-256 `220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079`, [MIT license](https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/blob/9403a6902bb58e3d5ae8c7e77c3422de279db2e0/LICENSE).
- Speaker embedding, which describes each voice so that the same speaker is recognized across the recording: [sherpa-onnx copy](https://huggingface.co/csukuangfj/speaker-embedding-models/tree/a8055d6daef723a6a4ecf4de233708575bf4994f) of [WeSpeaker ResNet34-LM](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM), trained on VoxCeleb2, file `wespeaker_en_voxceleb_resnet34_LM.onnx`, exactly `26530550` bytes, SHA-256 `e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012`, which matches the [sherpa-onnx release asset](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The voice model card lists English, so speakers in other languages may be separated less reliably. The pinned `sherpa-onnx-node` package runs both files; see the [sherpa-onnx speaker diarization documentation](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html).

The catalog is shipped with Movo. Each model has a role, `transcription` or `speakers`, and is downloaded with its own **Download model** action. A model is ready only when all of its files are verified, and a download fetches only the files that are missing. Only these pinned artifacts are recognized; arbitrary cached LLMs, other formats and other revisions are not imported automatically. GGUF verification also checks the file's declared architecture (`parakeet`); ONNX files are verified by their exact length and SHA-256.

## Shared Hugging Face cache

Movo uses the [standard Hugging Face cache](https://huggingface.co/docs/hub/local-cache), including files downloaded by Handy or another compatible client. It reads existing weights in place, follows cached links and does not create a second private model copy or an `installed.json` record.

Cache location, in priority order:

1. `HF_HUB_CACHE`.
2. `HF_HOME/hub`.
3. `XDG_CACHE_HOME/huggingface/hub`.
4. `~/.cache/huggingface/hub`.

On a typical Windows installation the default is `C:\Users\<user>\.cache\huggingface\hub`. Set environment variables for the Node server, then restart it. Cache selection is independent of `MOVO_DATA_DIR`.

Movo recognizes these files under the shared cache.

```text
<cache>/
  models--handy-computer--parakeet-ultra-gguf/
    snapshots/39eeb55181f0d354fd934f06e92fd8d5037fed8e/parakeet-ultra-Q8_0.gguf
  models--csukuangfj--sherpa-onnx-pyannote-segmentation-3-0/
    snapshots/9403a6902bb58e3d5ae8c7e77c3422de279db2e0/model.onnx
  models--csukuangfj--speaker-embedding-models/
    snapshots/a8055d6daef723a6a4ecf4de233708575bf4994f/wespeaker_en_voxceleb_resnet34_LM.onnx
```

When the Settings page first discovers these files, Movo verifies each file’s exact length and SHA-256. For the GGUF file, it also verifies the Parakeet architecture using the official [`@huggingface/gguf` parser](https://huggingface.co/docs/huggingface.js/gguf/README). Checks are coalesced in memory and reused while file identity, size, modification time and change time remain unchanged. Restarting the server or changing a file causes verification again. Model downloads start only on request.

A failed check shows **Needs repair** and names the affected file. Repair or remove that file through your cache-management tool, then choose **Check again**. You can download missing files from Settings.

## Explicit downloads

Open **Settings** and choose **Download model** under **Transcription**. The backend continues while you navigate, reload or close the browser; keep the Node server running.

Each transfer streams to its own randomly named `.movo-*.partial` file beside the destination. It rejects excess data and checks exact length and SHA-256 before publication. GGUF metadata is checked before publication as well.

Movo publishes the completed file with an exclusive filesystem hard link, then removes its own temporary name. This exposes a complete file without replacing an existing destination. The final snapshot file is a regular file, readable by HF cache clients; this does not require Windows symbolic-link privileges. The cache filesystem must support hard links, such as NTFS on Windows. An unsupported filesystem produces an error rather than an unsafe copy into a visible destination.

Separate processes can download concurrently without sharing partial files. If another process publishes first, Movo verifies the existing destination and leaves it intact. Concurrent transfers can duplicate network work; they do not require Redis or a cross-client lock. Movo does not use the JS SDK's shared `.incomplete` writer.

**Cancel installation** aborts the transfer and waits for its temporary file to be removed. Failure and graceful shutdown also clean owned partials. A retry reuses verified files and starts each missing file from the beginning. A forced process termination can leave an unused `.movo-*.partial` file. Movo only recognizes files published to their final cache paths.

The complete download is bounded at thirty minutes. Publication already in progress finishes before cancellation is reported. Cleanup errors are reported as failures.

## Integrity and runtime compatibility

SHA-256 verifies that bytes match the pinned artifact. GGUF metadata checks the format and declared architecture. Neither guarantees that a particular engine/backend has enough memory or can run every model capability.

Model setup does not load hundreds of megabytes of weights into the native engine. Runtime loading belongs to transcription execution. The project uses the pinned `transcribe-cpp` and `sherpa-onnx-node` Node packages; package installation includes their native platform dependencies, not model weights. See the [engine documentation](https://github.com/handy-computer/transcribe.cpp/blob/v0.4.1/bindings/typescript/README.md) for runtime prerequisites.

Shared cache files must be treated as immutable. Another tool can remove or replace them; Movo detects missing or changed files on subsequent discovery. It does not guarantee safety against arbitrary concurrent in-place modification by other software.

## HTTP interface and tests

- `GET /api/models` returns the curated catalog, verified availability and current download state with `Cache-Control: no-store`.
- `POST /api/models/:id/install` starts a download and returns HTTP 202.
- `POST /api/models/:id/cancel` waits for owned work to stop and returns its current state.

Only curated IDs are accepted; callers cannot supply a URL or destination path. Loopback host and same-origin checks apply. Responses omit filesystem paths.

Ordinary tests use tiny generated GGUF headers and model files, a loopback download server and isolated temporary caches. They verify cache reuse, changed/corrupt files, real parser rejection, models made of several files, two independent Node writers, publication collisions, cancellation and cleanup. Browser tests use an isolated cache and never inspect the user's weights. No-weights checks of both native runtimes catch missing runtime packages.

`bun run test:models:real` is opt-in: it downloads into an isolated temporary HF cache, checks the real CPU loader and rediscovery, then removes the temporary weights. Ordinary tests and CI never download models or run speech inference.
