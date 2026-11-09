# MCP access

Movo exposes its library, downloads and transcriptions to AI agents through the [Model Context Protocol](https://modelcontextprotocol.io/). The server is part of the running backend at `http://127.0.0.1:4310/mcp` (or the configured `PORT`) and uses the Streamable HTTP transport. Any MCP client that supports Streamable HTTP can connect; there is no separate process to start.

## Connect a client

Start Movo (`bun run dev` or `bun run start`), then register the endpoint in your client. For example:

```sh
claude mcp add --transport http movo http://127.0.0.1:4310/mcp
codex mcp add movo --url http://127.0.0.1:4310/mcp
```

Clients configured through a file use the same URL, such as `url = "http://127.0.0.1:4310/mcp"` in a Codex `[mcp_servers.movo]` table. Movo must be running whenever the client uses the tools.

Movo accepts protocol revisions 2026-07-28, 2025-11-25, 2025-06-18 and 2025-03-26. Sessions of the older revisions are kept in memory; after a restart the client starts a new one.

## Tools

| Tool                                                                  | Purpose                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_library`                                                      | Search titles and transcripts with the library's filters and sort orders; returns up to `limit` recordings (default 20, at most 100) after `offset`, with each recording's transcription state, the total and passage matches |
| `get_recording`                                                       | A recording and the state of its transcription                                                                                                                                                                                |
| `read_transcript`                                                     | Timestamped passages from `fromMs`, up to `maxPassages` (default 200, at most 300); continue with `nextFromMs`                                                                                                                |
| `list_downloads`, `get_download`                                      | Download jobs, newest first, paged with `limit` and `offset` like `search_library`, and one job's state                                                                                                                       |
| `preview_link`                                                        | Title and duration of a YouTube or X link without downloading                                                                                                                                                                 |
| `download_links`                                                      | Queue links in order with one preset and optional transcription; nothing is queued if any link is invalid                                                                                                                     |
| `cancel_download`, `retry_download`                                   | Stop or restart a download                                                                                                                                                                                                    |
| `import_file`                                                         | Copy a local file into the library from an absolute path                                                                                                                                                                      |
| `transcribe_recording`, `cancel_transcription`, `retry_transcription` | Queue, stop or restart transcription; retrying a completed one transcribes it again                                                                                                                                           |
| `edit_transcript`, `replace_in_transcript`                            | Correct a passage by its `firstWord` and `wordCount` from `read_transcript`, or replace a word or phrase everywhere                                                                                                           |
| `list_transcript_changes`, `restore_transcript`                       | List a transcript's versions, paged like `search_library`, and return to an earlier one                                                                                                                                       |
| `rename_recording`                                                    | Change a library title                                                                                                                                                                                                        |
| `remove_saved_copy`, `delete_recording`                               | Remove the saved file while keeping the transcript, or delete the whole recording                                                                                                                                             |

The tools call the same operations as the browser, with the same validation, job lifecycle and error messages. Downloads and transcriptions run in the background after a tool returns; agents follow them with `get_download` and `get_recording`. Passage matches from `search_library` carry a `startMs` that `read_transcript` accepts as `fromMs`. Transcript edits use the same versions as the browser: `read_transcript` and `get_recording` return the current `revision`, every change must name it, and a change based on an older version is rejected so the agent reads the transcript again. `get_recording` also returns `resultRevision`, the version of the transcription result, which is the earliest version `restore_transcript` accepts. Changes made over MCP are marked as such in the browser's history.

Each tool declares MCP hints: the seven query tools are read-only, `retry_transcription`, `remove_saved_copy` and `delete_recording` are destructive, and the tools that contact YouTube or X are marked as open-world. Clients can use these hints to ask for confirmation before a destructive call.

Installing the transcription model, FFmpeg/FFprobe or yt-dlp is not available through MCP. A tool that needs a missing component returns the same message as the browser, and the component is installed in the Movo app.

A failed operation returns a tool error with a readable message, for example `Media not found.` or `Install the transcription model first.`, so the agent can correct the request.

## Import by path

`import_file` reads the file at an absolute path on the computer running Movo and copies it into managed storage through the regular import: FFprobe must recognize it as audio or video, and the 10 GiB limit applies. The original file is only read. Copying a large file can exceed a client's tool timeout, such as Codex's default of 60 seconds; raise the client's limit (for Codex, `tool_timeout_sec`) for large imports.

## Security

The endpoint follows the same rules as the HTTP API: Movo listens only on `127.0.0.1`, rejects requests addressed to other host names and rejects any request that carries an `Origin` header, so web pages cannot call it. There is no token; any local process that can reach the port can use the tools, as it can use the HTTP API. MCP requests are limited to 64 KiB.
