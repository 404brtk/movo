# movo

A local media workspace. Import audio and video or download public videos and podcast episodes from YouTube, X, TikTok, Instagram, Facebook, Twitch, Apple Podcasts, Google Drive and Dropbox into a persistent library, play saved copies and generate local transcripts with word-level timestamps, then correct them with a version history and ask questions about them with a model you connect. Downloads and transcription run in the background while you browse other recordings. Model installation is optional and explicit.

## Requirements

- Node **26.13.0**, pinned in `.node-version` and `.nvmrc`.
- Bun for installing dependencies and running project scripts.
- FFprobe for imports. Movo detects existing tools and offers an explicit download of FFmpeg and FFprobe when needed. The app starts without either tool or any model weights.
- Native model loading uses the bundled `transcribe-cpp` Node binding and its optional platform-native package. Keep optional dependencies enabled when installing the app. On Windows x64, native loading requires [Microsoft Visual C++ 2015–2022 Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe) version 14.40 or newer. Cache discovery and model downloads do not load the native engine.
- For link downloads, both FFmpeg and FFprobe plus the [official yt-dlp standalone executable](https://github.com/yt-dlp/yt-dlp#installation). Movo detects an existing yt-dlp and offers an explicit download of a private copy when needed. Its bundled JavaScript components use Movo's Node executable.
- Windows' system `tar`, or `tar` and `xz` on Linux, for downloading/unpacking tools and running integration tests. Movo selects `%SystemRoot%/System32/tar.exe` on Windows so Git's bundled GNU tar cannot override it. Existing FFmpeg/FFprobe installations can be used without unpacking anything.

Bun manages dependencies and invokes scripts. Node runs the backend and JavaScript tooling. Use the pinned Node version when installing dependencies because SQLite uses a native addon.

## Start developing

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:5173` or `http://127.0.0.1:5173`. The local API listens on `127.0.0.1:4310`; Vite proxies API requests while preserving the browser's host so same-origin checks work with either address. No model download is required. Husky installs the local pre-commit hook during dependency installation.

For the built application:

```sh
bun run build
bun run start
```

Open `http://127.0.0.1:4310`. The Node server serves both the browser application and API.

An optional `.env` file can override `PORT`, `MOVO_DATA_DIR`, `FFPROBE_PATH`, `FFMPEG_PATH` and `YTDLP_PATH`. The data directory must be absolute and defaults to `~/.movo`. Local databases and media/model files are outside the source tree. Copy `.env.example` only if overrides are needed. Leave executable overrides unset to use automatic discovery.

One backend owns a data directory at a time. Movo holds an exclusive SQLite transaction on the dedicated `instance.sqlite` file before opening the application database or recovering jobs; a second backend receives a clear error even when using another port. The lock is released on shutdown or process termination. The lock database remains in the data directory and must not be deleted while Movo runs. It holds no application data and does not block the application database. Independent data directories can be used by separate backends.

## Media tools

**Models** lists FFprobe and FFmpeg under **Tools**; **Import files** opens the same check when they are missing. Discovery tries an explicit executable override, then Movo's managed installation, then absolute directories on `PATH`. Broken explicit overrides are reported instead of silently replaced. Imports require only FFprobe and check it before uploading or storing the file.

Choose **Download media tools** to download a private copy of both executables. The panel shows the build provider, version, compressed size and progress. Downloads continue when the panel is closed or the page is reloaded. Movo verifies the pinned size and SHA-256, extracts only the selected executables and license, checks both executables, then activates the completed installation without restarting the app. Existing system installations and `PATH` are untouched.

Automatic downloads support Windows x64 and Linux x64 with glibc 2.28 or newer. Other platforms can use manually installed tools. A stopped download is retried from the beginning; an interrupted staging directory is cleared on the next installation attempt. Previous managed copies remain available to processes already using them, and a failed repair preserves the active installation. See [media tools](docs/media-tools.md) for sources, configuration and validation.

## Import local media

Choose **Import files** in the library, then add files with **Choose files** or drop them onto the dialog. Remove any file you do not want before choosing **Import**. Files are imported one at a time: each is streamed to managed storage and inspected with FFprobe before appearing in the list. A rejected file stays listed with its reason while the others continue. **Cancel** stops the current upload and keeps the files that were not imported listed. The dialog stays open until the import finishes or is cancelled, and the browser asks before leaving the page during an import. Turn on **Transcribe after import** to queue each recording for transcription as it is saved. FFmpeg is then checked before anything is uploaded; when the transcription model is missing, the first file is rejected without being stored and the import stops. The library records the original filename, media type, duration, size and import time. Files are limited to **10 GiB** each. Importing the same filename again creates a separate item.

Open an item to play or seek through its saved copy. **Save a copy** downloads the original imported bytes. Browser playback depends on the file's codecs; no automatic transcoding is performed. Supported containers include MP4/MOV/M4A, WebM/Matroska, MP3, WAV, Ogg, FLAC and AAC. No model weights are required.

Choose **Rename recording** from a recording's **More actions** menu to change its library title. The original filename and saved bytes stay unchanged; transcript downloads use the updated title. Titles accept 1–512 characters without control characters, with surrounding whitespace removed.

**Delete recording…** in **More actions** asks for confirmation before permanently removing Movo's saved copy, its transcript, temporary files and linked download history. Imported originals and shared models stay untouched. Cancel a queued or running transcription first; a download still publishing its recording must finish. Removing a downloaded recording also allows its source URL to be downloaded again. Missing saved copies can still be removed from the library.

Choose **Remove saved copy…** in **More actions** of a transcribed recording to free up disk space while keeping it in the library. After confirmation, Movo permanently deletes its saved copy; the title, transcript, text/subtitle exports and download history stay. Playback, **Save a copy** and transcribing again are no longer available, and the library shows the size as removed. The action appears only once a transcript exists and is rejected while a transcription is queued or running or a download is still publishing the recording. Imported originals stay untouched. A downloaded recording keeps its completed download, so the same link and option are not downloaded again; delete the recording first to download it anew. **Delete recording…** still removes the whole item.

Deletion and saved-copy removal keep the saved copy under a temporary `.deleting` filename until SQLite commits. A failed transaction restores the file alongside its metadata. Before starting workers or serving requests, Movo recovers pending files for recordings that still have a saved copy and removes remnants of committed deletions and removals. Recovery never overwrites an existing media file. If cleanup fails after the deletion commits, the confirmation shows a warning and offers a return to the library; close apps using the copy or check permissions, then restart Movo to retry cleanup.

To check the current workflow, import a small recording, open its library entry, play and seek, then refresh the page. Restart the app to verify that the entry remains. Use **Save a copy** to retrieve its stored bytes; the original file should remain in its original location.

Metadata is stored in `MOVO_DATA_DIR/app.sqlite`; managed copies are stored in `MOVO_DATA_DIR/media/` under generated identifiers. Original source files are never moved, changed or deleted. Normal import failures remove their partial copies. An abruptly stopped app can leave unindexed files, which are not shown or served as completed imports; interrupted imports are not resumable.

The local API provides `GET /api/media`, `POST /api/media`, `GET /api/media/:id`, `PATCH /api/media/:id`, `DELETE /api/media/:id`, `GET`/`HEAD /api/media/:id/file` and `DELETE /api/media/:id/file`. Rename requests use JSON `{ "title": "New title" }` with a 4 KiB body limit. Delete returns the removed metadata with an optional `cleanupError` after committed cleanup failure, or HTTP 409 while related work is queued or running. Import requests contain the raw file body and a URI-encoded filename in `X-File-Name`. The optional `transcribe=true` query parameter checks the transcription prerequisites before storing the body and queues the transcription together with the saved recording; other values return HTTP 400. A request closed before the recording is saved stores nothing. Metadata responses follow the Effect schemas in `src/shared/contracts/media.ts`. `GET /api/media` accepts the optional `q` (up to 200 characters), `kind` (`audio`, `video`), `transcript` (`available`, `missing`) and `sort` (`relevance`, `newest`, `oldest`, `title`) query parameters and returns HTTP 400 for other values; its response follows `src/shared/contracts/library.ts`: the matching `items`, each with its `transcription` state and a `match` object on search results, and `transcribing`, which is true while any transcription is queued or running. `transcription` is `active` while the recording's transcription is queued or running, `done` when it has a transcript, `stopped` when its last attempt failed, was cancelled or was interrupted without leaving a transcript, and `none` when it was never transcribed. Playback supports HTTP byte ranges.

## Search the library

Type in **Search** above the library list to find recordings by title and saved transcript text. Every word must appear in the title or transcript, and each word also matches longer words that start with it, so `nagra` finds “nagranie” and “nagrania”. Case and Latin diacritics are ignored, including letters such as ł, ø, đ and ħ: `lodz` finds “Łódź”. Search punctuation and operators are treated as plain text.

Transcript results show up to three matching passages with their timestamps and the number of further matches. Choose a passage to open the recording at that moment; the player starts there and the transcript scrolls to the passage. A transcript kept during a replacement transcription remains searchable until the new one completes. Recordings whose saved copy was removed stay searchable; their passage links open the transcript at that passage.

**Type** limits results to audio or video, **Transcript** to recordings with or without a saved transcript, and **Sort by** orders them by best match (while searching), newest, oldest or title. The search, filters and order are kept in the page address, so they survive a refresh and the browser's back button. **Clear search and filters** appears when nothing matches. While any transcription is queued or running, the library refreshes every two seconds, so a finished transcript appears in filtered and search results without reloading.

Search uses two SQLite FTS5 full-text indexes in `app.sqlite`: one row per recording (title and transcript) decides which recordings match and how they rank, and one row per transcript passage, with its start time, supplies the previews. Search therefore never reads the stored transcripts. Movo updates both indexes in the same transaction as imports, renames, deletions and completed transcripts. When the passage rules or the search text folding change, Movo rebuilds the indexes once at startup.

## Download from a link

Choose **Download from link** in the library or in **Downloads** and paste one or more links into **Add links**, or type one and press Enter. Every link becomes a row in the order pasted; the same item pasted twice keeps one row, and up to 20 links can be added at a time. Text that is not a link stays in the field. Movo recognizes each site instantly, then asks yt-dlp for the title and duration of two links at a time, so rows fill in while you choose options. If yt-dlp is missing or broken, Movo opens the **yt-dlp** panel and checks the links once it is ready. Choose **Download yt-dlp** to install a private copy of the pinned official release; it is usable as soon as the download completes, without restarting. Discovery, verification and supported platforms follow the same rules as media tools; see [media tools](docs/media-tools.md#yt-dlp).

Each row has its own **Video** or **Audio** choice, and **Set all to** changes every row at once. New rows start with the last choice made. Apple Podcasts episodes show **Audio only** and are always saved as audio. **Quality** and **Transcribe after download** are shared and apply to every row; Quality appears only while a row is saved as video. Rows that cannot be downloaded are skipped and listed first with the reason: an unsupported site, a source yt-dlp could not open (with **Check again**), or an item already saved or queued with the same choice (with **Open** when it is in the library). **Remove skipped** clears them, and the download button counts only the rows that will be queued. Rows still being checked are queued too and checked when their download starts. After **Download**, the dialog closes and you stay on the current page; a notice confirms how many downloads were added and offers **View downloads**. Open **Downloads** from any page to see the selected option, the downloaded and expected size, and to cancel or retry; the header shows the active download’s progress on other pages. You can open another recording while a download runs, close the tab or reload it. Keep the local Node server running.

Turn on **Transcribe after download** before choosing **Download** to queue local transcription automatically after the recording is saved. This works with video and audio from every supported site. The backend checks FFmpeg and the installed Parakeet Ultra model before accepting this option; it never installs tools or weights automatically. The switch is off by default.

The option persists with the download, including retries and restarts. Download completion and creation of the transcription job are committed together; recovery also queues transcription if the recording was already saved when Movo stopped. Failed or cancelled downloads do not start transcription. In **Downloads**, completion means the media is saved; choose **Open** for transcription progress, cancellation, retry and the eventual text/export actions. A transcription failure leaves the recording and completed download intact. Both stages continue independently of the browser while Movo runs.

The defaults are one active download, video up to 1080p and a 10 GiB size limit. **Quality** offers 480p, 720p, 1080p or **Best**. Limits apply to the shorter side of the frame, so a vertical 1080×1920 video counts as 1080p: lower-resolution sources remain lower, nothing is upscaled, and a source without a format within the limit fails instead of exceeding it. **Best** removes the cap. A format with unknown dimensions is used only when no format with known dimensions fits. Movo prioritizes resolution and frame rate, then prefers H.264/AAC and requests MP4 merging without transcoding.

**Audio** downloads the best available audio-only stream. YouTube audio keeps its source container. Audio from the other sites uses FFmpeg to extract the source audio without keeping video; if no audio-only stream is available, it temporarily downloads the combined video/audio file first. TikTok audio always comes from the combined file, because its audio-only stream is the post's background sound rather than the recording. Apple Podcasts episodes are saved as audio whichever option is selected; FFmpeg fetches video podcasts, which Apple serves as HLS streams, before their audio is extracted. Twitch clips and TikTok videos only offer combined video/audio formats, so their video quality is chosen among those. Audio extraction uses yt-dlp's `best` audio format rather than forcing MP3. FFprobe inspects every result before it is saved; FFmpeg is required for video merging and audio extraction. Actual codecs depend on the source, so browser playback is not guaranteed for every file. The same 10 GiB download limit applies to both modes, including a temporary combined stream. Format selection uses [yt-dlp's documented filters and sorting](https://github.com/yt-dlp/yt-dlp#format-selection).

Downloads support single, public, completed items: YouTube videos, X posts with one directly attached video, TikTok videos, Instagram posts and reels, Facebook videos and reels, Twitch videos and clips, Apple Podcasts episodes, and Google Drive and Dropbox files shared with anyone who has the link. Each link is normalized to one canonical URL per item and checked against the extractor and item ID that yt-dlp reports. Both `x.com` and `twitter.com` links are accepted and normalized by post ID, including supported mobile aliases and share parameters. Posts with multiple videos, external players, broadcasts, individual `/video/N` or `/photo/N` attachment links, profiles, playlists, live/upcoming streams and sign-in/cookies are outside this implementation. A YouTube video link containing a playlist parameter downloads only that video. TikTok short links (`vm.tiktok.com`), `fb.watch` links, Instagram stories, Apple Podcasts show pages, Drive folders, Dropbox folders and Dropbox links without their `rlkey` are not supported. Private Drive and Dropbox files need sign-in, so download them yourself and import the file. Reddit and Spotify are not supported; Spotify streams are DRM-protected. Public-source access can still be blocked or limited by the service; access failures outside YouTube show guidance rather than asking for account cookies.

Jobs, source URLs and selected download options persist in SQLite. The same normalized URL and option return their existing job; different qualities or audio create independent jobs and library entries. Use **Retry** for a failed, cancelled or interrupted job. Retry preserves its selected option, starts from the beginning and goes to the end of the queue. Queued jobs start automatically after a restart; an active download interrupted by shutdown needs an explicit retry. If the media was already published before an interrupted job could record completion, startup reconciles it with the library. Run one Movo backend per data directory.

Requesting automatic transcription for an existing download enables it on that job without downloading another copy. A subsequent download-only request does not remove the earlier transcription request. Existing transcription jobs and results are preserved, including cancelled or failed attempts; use transcription's explicit retry rather than submitting the download again. Existing downloads migrate with automatic transcription disabled.

Existing jobs migrate to the previous default, video up to 1080p, without changing IDs, saved media references, results or cleanup warnings.

Concurrent retry requests are serialized so a second request cannot remove files from a newly started attempt. Retrying a job already requeued or running is rejected. Once accepted, a retry finishes cleanup and requeueing before interruption can release its lock.

Partial files and private source metadata stay in `MOVO_DATA_DIR/downloads/<job-id>/`. Successful downloads are inspected by FFprobe and moved into the regular library, retaining their source URL. Cancellation waits for the owned process tree to stop and removes its temporary files. Normal completion/failure also removes staging files; restart clears staging for finished or interrupted jobs. The final save to the library finishes before cancellation or shutdown can interrupt it.

If temporary files cannot be removed, Movo records a separate cleanup warning on that job and continues serving the library and other downloads. Saved media stays available. Retrying a failed, cancelled or interrupted job first requires successful cleanup; restarting Movo also attempts cleanup again without discarding the original download error.

The API provides `POST /api/downloads/preview` with a JSON `{ "url": "https://www.youtube.com/watch?v=…" }` body. `POST /api/downloads` accepts `{ "urls": ["https://www.youtube.com/watch?v=…"] }` with at least one link and an optional `preset`: `video-480p`, `video-720p`, `video-1080p`, `video-best` or `audio`. Omitting it preserves the `video-1080p` default. Optional `transcribe: true` requests transcription after download; omission defaults to false. It returns one job per link, in request order, and queues nothing if any link is invalid. Download request bodies are limited to 1 MiB. Job responses include `preset` and `transcribe`. Other endpoints are `GET /api/downloads`, `GET /api/downloads/:id`, `POST /api/downloads/:id/cancel` and `POST /api/downloads/:id/retry`. Enqueue and retry return HTTP 202 after validation and optional transcription prerequisites; the workers own processing independently of the request. Contracts live in `src/shared/contracts/downloads.ts`.

## Install a transcription model

Open **Models** from the header. The initial catalog contains **Parakeet Ultra Q8_0**, a 740 MB GGUF conversion published by Handy from Moondream's model. The page shows its size, license, source and supported languages. Choose **Download model** explicitly; opening the app or the catalog never downloads weights.

Movo reuses the pinned weights from your shared Hugging Face cache, including files downloaded by Handy, without another copy or an installation manifest. It verifies size, SHA-256 and GGUF metadata on discovery and remembers the result in memory while the file is unchanged. The cache defaults to `~/.cache/huggingface/hub`; `HF_HUB_CACHE`, `HF_HOME` and `XDG_CACHE_HOME` can override it.

New downloads use unique temporary files and publish verified weights without overwriting existing shared files. They continue while you browse or reload, provided the backend remains running, and support cancellation and retry. Damaged shared files require explicit repair through your cache-management tool. Model setup checks the artifact without loading it into the native engine; runtime compatibility is checked when the engine is used. See [model setup](docs/models.md) for storage, provenance and validation limits.

## Transcribe a recording

Open a saved recording and choose **Transcribe**. Movo uses Parakeet Ultra locally on a supported GPU when one is available, otherwise on the CPU, and shows which device runs it, step by step. Audio is prepared with FFmpeg. A missing model links to **Models**, and a failed transcription offers **Media tools** next to **Retry transcription**. Transcribing never downloads a model automatically.

One transcription runs at a time; other recordings wait in the persistent queue. You can navigate away or reload while it runs. Choose **Cancel transcription** to stop it, **Retry transcription** after failure or interruption, or **Transcribe** again after cancelling. A recording has one saved transcript. While the recording plays, the current passage and word are highlighted. Click a passage's timestamp to seek its player. A successful recording without recognized speech shows an explicit empty result.

Completed transcripts with speech offer **Copy transcript** and **Export transcript** (**Download TXT**, **Download SRT**, **Download VTT**) above the passages. TXT and copying contain plain text; SRT and VTT contain timestamped subtitles. Downloads use UTF-8 and the recording title as the suggested filename. Clipboard failures show guidance and leave TXT available. Exporting reuses the saved result without running the model again.

Completed transcripts survive restarts. Queued work resumes; an active operation interrupted by shutdown needs an explicit retry. Temporary audio is separate from saved media and shared model weights. Long recordings need additional disk space and memory for decoded audio. See [local transcription](docs/transcriptions.md) for storage, resource use and HTTP endpoints.

## Use Movo from an AI agent

The running backend also serves an MCP endpoint at `http://127.0.0.1:4310/mcp`. Register it in any MCP client that supports Streamable HTTP, for example `claude mcp add --transport http movo http://127.0.0.1:4310/mcp` or `codex mcp add movo --url http://127.0.0.1:4310/mcp`. Agents can search the library, read transcripts, download links, import local files by absolute path, start, cancel and retry transcriptions, rename recordings and remove them. Installing the model, FFmpeg/FFprobe or yt-dlp stays in the app. The endpoint has the same local-only access rules as the HTTP API. See [MCP access](docs/mcp.md) for the tools and client setup.

## Verification

```sh
bun run check
bun run test:e2e:install
bun run test:e2e
```

`bun run test:tools:real` is an opt-in check that downloads the platform's pinned package into a temporary directory, imports real audio and converts it using the managed executables. It requires internet access and is excluded from ordinary tests and CI.

`bun run test:downloads:real` separately previews and downloads short public YouTube and X videos in video and audio-only modes, validates their library entries and decodes the first second of audio, then removes the temporary databases and media. It requires internet access, yt-dlp, FFmpeg and FFprobe. Set `MOVO_TEST_X_URL` to your chosen public X post with one video; no X post is bundled as a default. The suite fails before any downloads if this variable is missing. `MOVO_TEST_YOUTUBE_URL` optionally selects another YouTube source. Ordinary tests and CI use synthetic source/process fixtures and never contact those services.

`bun run test:models:real` separately downloads the pinned model into an isolated temporary HF cache, verifies and loads it with the real native engine, checks rediscovery, then removes the weights and temporary files. Ordinary tests use tiny generated GGUF files and real temporary caches, including concurrent Node writers. They initialize the native engine without weights and reject a tiny invalid model. They do not download models or run speech inference.

`check` verifies formatting, linting, types, fast tests and the production build. Browser tests use a fresh temporary data directory and the built server. On Linux, browser system packages can be installed with `bun run test:e2e:install --with-deps`.

Pre-commit formats/lints staged files, then runs types and fast tests. CI checks the application and Chromium flows on Ubuntu and Windows, using Movo's pinned FFmpeg package. The workflow uses read-only repository permissions and commit-pinned actions.

See [testing policy](docs/testing.md) for test selection and [custom lint rules](tooling/lint/README.md) for rule development. Authored JavaScript/TypeScript comments are lint errors; the generated route tree is excluded.

## Project layout

[AGENTS.md](AGENTS.md) holds project-specific agent instructions; `CLAUDE.md` imports it. Shared docs describe supported code and contributor workflows. Exploratory research and personal planning notes belong in ignored `.agent-notes/`.

Browser code lives in `src/web`, server code in `src/server`, and browser-safe schemas in `src/shared`. TanStack generates `src/web/routeTree.gen.ts`; keep that file generated rather than editing it. `bun run routes:generate` refreshes it before type checking/building.

Drizzle schemas live in `src/server/**/*.schema.ts`; generated, versioned migrations are committed under `migrations/`. The server applies pending migrations when opening the database. After a schema change, use `bun run db:generate` and restart the app. `bun run db:migrate` also applies migrations explicitly to the configured data directory.

## Dependency updates

`bun run audit:runtime` checks production dependencies; `bun run audit` includes development tools. Inspect the current command output for findings rather than relying on a dated audit snapshot.

Keep one Bun lockfile. Check the selected libraries' current documentation before changing APIs, then run all checks and browser tests. Update native dependencies using the pinned Node version. Model weights, downloaded media, databases and secrets do not belong in Git.

## Ask

**Ask** answers questions about transcripts with a model you connect on the **Models** page: an Anthropic, OpenAI or OpenRouter API key, or a server such as Ollama, LM Studio, Jan or llama-server on this computer or your home network. Open it beside a recording with **Ask** or `/`, or across the library from the **Ask** tab. Every transcript change it proposes waits for your approval. See [Ask](docs/ask.md) for connections, keys, tools and context handling.
