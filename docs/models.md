# Local model setup

Model weights are optional. The library, imports and YouTube/X downloads work without them. This feature manages model availability; transcription jobs and transcript presentation are separate product work.

## Supported model

The initial curated entry is **Parakeet Ultra Q8_0** (`parakeet-ultra-q8`).

- Upstream model: [Moondream Parakeet Ultra](https://huggingface.co/moondream/parakeet-ultra), post-trained from NVIDIA Parakeet v3.
- Converted weights: [Handy GGUF repository](https://huggingface.co/handy-computer/parakeet-ultra-gguf/tree/39eeb55181f0d354fd934f06e92fd8d5037fed8e).
- Revision: `39eeb55181f0d354fd934f06e92fd8d5037fed8e`.
- File: `parakeet-ultra-Q8_0.gguf`, exactly `740363168` bytes.
- SHA-256: `007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59`.
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); retain attribution to the upstream model and conversion publishers.

The catalog is shipped with Movo. Only this pinned artifact is recognized; arbitrary cached LLMs, other formats and other revisions are not imported automatically.

## Shared Hugging Face cache

Movo uses the [standard Hugging Face cache](https://huggingface.co/docs/hub/local-cache), including files downloaded by Handy or another compatible client. It reads existing weights in place, follows cached links and does not create a second private model copy or an `installed.json` record.

Cache location, in priority order:

1. `HF_HUB_CACHE`.
2. `HF_HOME/hub`.
3. `XDG_CACHE_HOME/huggingface/hub`.
4. `~/.cache/huggingface/hub`.

On a typical Windows installation the default is `C:\Users\<user>\.cache\huggingface\hub`. Set environment variables for the Node server, then restart it. Cache selection is independent of `MOVO_DATA_DIR`.

The recognized file is:

```text
<cache>/models--handy-computer--parakeet-ultra-gguf/
  snapshots/39eeb55181f0d354fd934f06e92fd8d5037fed8e/
    parakeet-ultra-Q8_0.gguf
```

When the Models page first discovers this file, Movo verifies its exact length and SHA-256, then parses the GGUF metadata using the official [`@huggingface/gguf` parser](https://huggingface.co/docs/huggingface.js/gguf/README) and requires the Parakeet architecture. Checks are coalesced in memory and reused while file identity, size, modification time and change time remain unchanged. Restarting the server or changing the file causes verification again. Opening the application never downloads weights.

A failed check shows **Needs repair**. Movo does not overwrite or delete a shared model to repair it. Repair or remove the affected file through your cache-management tool, then choose **Check again**. A missing file can be downloaded explicitly.

## Explicit downloads

Open **Models** and choose **Download model**. The backend continues while you navigate, reload or close the browser; keep the Node server running.

Each transfer streams to its own randomly named `.movo-*.partial` file beside the destination. It rejects excess data and checks exact length and SHA-256 before publication. GGUF metadata is checked before publication as well.

Movo publishes the completed file with an exclusive filesystem hard link, then removes its own temporary name. This exposes a complete file without replacing an existing destination. The final snapshot file is a regular file, readable by HF cache clients; this does not require Windows symbolic-link privileges. The cache filesystem must support hard links, such as NTFS on Windows. An unsupported filesystem produces an error rather than an unsafe copy into a visible destination.

Separate processes can download concurrently without sharing partial files. If another process publishes first, Movo verifies the existing destination and leaves it intact. Concurrent transfers can duplicate network work; they do not require Redis or a cross-client lock. Movo does not use the JS SDK's shared `.incomplete` writer.

**Cancel installation** aborts the transfer and waits for its temporary file to be removed. Failure and graceful shutdown also clean owned partials. Other clients' files are left untouched. Retry starts from the beginning. A forced process termination can leave an unused `.movo-*.partial` file; it is never recognized as an available model.

The complete download is bounded at thirty minutes. Publication already in progress finishes before cancellation is reported. Cleanup errors are reported as failures.

## Integrity and runtime compatibility

SHA-256 verifies that bytes match the pinned artifact. GGUF metadata checks the format and declared architecture. Neither guarantees that a particular engine/backend has enough memory or can run every model capability.

Model setup does not load hundreds of megabytes of weights into the native engine. Runtime loading belongs to transcription execution. The project uses the pinned `transcribe-cpp` Node package; package installation includes its native platform dependency, not model weights. See the [engine documentation](https://github.com/handy-computer/transcribe.cpp/blob/v0.4.1/bindings/typescript/README.md) for runtime prerequisites.

Shared cache files must be treated as immutable. Another tool can remove or replace them; Movo detects missing or changed files on subsequent discovery. It does not guarantee safety against arbitrary concurrent in-place modification by other software.

## HTTP interface and tests

- `GET /api/models` returns the curated catalog, verified availability and current download state with `Cache-Control: no-store`.
- `POST /api/models/:id/install` starts a download and returns HTTP 202.
- `POST /api/models/:id/cancel` waits for owned work to stop and returns its current state.

Only curated IDs are accepted; callers cannot supply a URL or destination path. Loopback host and same-origin checks apply. Responses omit filesystem paths.

Ordinary tests use tiny generated GGUF headers, a loopback download server and isolated temporary caches. They verify cache reuse, changed/corrupt files, real parser rejection, two independent Node writers, publication collisions, cancellation and cleanup. Browser tests use an isolated cache and never inspect the user's weights. A no-weights native-engine check catches missing runtime packages.

`bun run test:models:real` is opt-in: it downloads into an isolated temporary HF cache, checks the real CPU loader and rediscovery, then removes the temporary weights. Ordinary tests and CI never download models or run speech inference.
