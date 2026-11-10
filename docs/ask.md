# Ask

Ask answers questions about transcripts with a language model the user connects. It has two places: a panel beside a recording, about that recording only, and the **Ask** page, about the transcribed recordings in the library.

## Connecting models

Connections are managed under **Ask** on the **Models** page.

- **API keys** for Anthropic, OpenAI and OpenRouter (**Add key**). Connecting reads the provider's model list, which verifies the key without generating text. A rejected key is reported, stays in the field and nothing is saved. **…** on a connected provider replaces or removes the key.
- **Servers** that speak the OpenAI-compatible API, such as Ollama, LM Studio, Jan or llama-server. Movo checks Ollama (port 11434), LM Studio (1234) and Jan (1337) on `127.0.0.1` only while the Models page, the "Connect a model" panel or the model picker is open, about every 30 seconds. There is no background check and no network scan. Any other server is added with **Add address**.
- Server addresses must be on this computer (loopback) or the home network (`10/8`, `172.16/12`, `192.168/16`, IPv6 unique-local addresses, `.local` names). The form says which one an address is while it is typed and warns that plain http crosses the network unencrypted. Internet addresses are rejected; use an API key instead. A key is optional for servers that require one. Ollama on another computer must listen on the network, for example with `OLLAMA_HOST=0.0.0.0:11434`.

Keys are stored in plain text in `app.sqlite` inside the data directory. On Linux and macOS Movo sets the data directory to mode `0700` at startup, so only the user's account can read it; on Windows the default location is inside the user's profile. The API returns only the last four characters of a key. Removing a connection deletes its key; chats that used it keep their history and ask for another model.

Models are never hard-coded:

| Source        | Model list                                        | Tool support                                                  | Input limit                                           |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| Anthropic     | `GET /v1/models?lifecycle=active`                 | all models                                                    | `max_input_tokens`                                    |
| OpenAI        | `GET /v1/models`, filtered by name to chat models | assumed                                                       | 128,000 assumed                                       |
| OpenRouter    | `GET /api/v1/models?supported_parameters=tools`   | only such models are listed                                   | `context_length`                                      |
| LM Studio     | `GET /v1/models`                                  | `capabilities.trained_for_tool_use` from `GET /api/v1/models` | the loaded instance's `context_length`                |
| Ollama        | `GET /v1/models`                                  | `capabilities` from `POST /api/show`                          | `context_length` of running models from `GET /api/ps` |
| Other servers | `GET /v1/models`                                  | unknown until used                                            | —                                                     |

Models that can't use tools are shown but can't be chosen. When a server doesn't report a limit, Movo assumes 4,096 tokens, Ollama's default below 24 GiB of VRAM ([context length](https://docs.ollama.com/context-length)). The browser caches cloud model lists for an hour and server lists for 30 seconds.

**New chats answer with** sets the default model. Each chat remembers its own model; choosing another model mid-chat keeps the conversation and marks the change.

## Asking

- **Panel:** closed by default and remembered per browser. It opens with **Ask**, `/`, or **Ask about this** on selected transcript text, which attaches the passage and its moment to the next question. At 1100 px and wider it sits beside the transcript; between 700 and 1099 px it floats over the right edge; below 700 px it fills the screen and a timestamp closes it. One chat per recording is shown; earlier chats are under the clock. Before a transcript exists the field offers **Transcribe**.
- **Ask page:** the field sits at the top with a scope menu: **All recordings**, **Audio**, **Video** or **Choose recordings…** (up to 200). A line says how many recordings have a transcript and offers **Transcribe the rest**. Recent chats are listed below. Answers list their sources grouped by recording, with the quoted passages and the searched words highlighted.

Sending a question saves it, starts the answer in the background and returns immediately. The answer continues when the panel is closed or the page is left. The browser follows it over Server-Sent Events at `/api/ask/chats/:id/live`, which sends the text written so far, the step in progress and new text as it arrives. A question typed while an answer runs is sent when it ends. **Stop** (or `Esc`) keeps the partial answer. An answer interrupted by a restart is marked as failed.

When an answer fails, the field names the reason and offers the fix: **Try again** when the provider is busy or a local server isn't running, **Update key** when a key is rejected, and **Change model** when a model can't use tools or is no longer available.

## Tools and safety

The model works through tools shared with the [MCP server](mcp.md): `search_library`, `get_recording`, `read_transcript` and `list_transcript_changes`, plus `edit_transcript` and `replace_in_transcript` in the recording panel. Every edit waits for **Change** or **Don't change**; the card then folds into one line such as "Replaced 3 places" with **Undo**, and the transcript history shows the change as made by Ask. The server rejects tool calls for any recording outside the chat's recording or scope, because transcript text could contain instructions. Library chats are read-only.

Answers are rendered as Markdown without HTML or images. Links to `/media/<id>?startMs=<ms>` open the recording at that moment, where the passage takes an accent wash. Other links open only when clicked. Zero-width and bidirectional control characters are shown as `[U+XXXX]`.

## Context

Provider APIs keep no conversation state, so Movo rebuilds the prompt for every answer from the full history in SQLite. The instructions and tool definitions come first and do not change within a chat. Anthropic requests mark the latest message as a cache breakpoint, and OpenRouter requests to Anthropic and Google models mark the latest question; OpenAI caches long prompts automatically.

When the estimated prompt passes 75% of the model's input limit, results of tool calls older than the last two turns are replaced by short notes asking the model to read again if needed. If that is not enough, the oldest turns are dropped from what the model sees, four at a time. Both positions are stored with the chat and only move forward, so later prompts keep the same beginning. The chat shows "Older messages are no longer visible to the model" where the visible part begins; nothing is removed from the history. Transcript pages shrink as the free context gets smaller. Movo does not summarise older messages. The estimate uses characters per token calibrated from the input tokens the provider reported for the previous answer.

## Keyboard and motion

- `/` opens the panel with the caret in the field. `Esc` stops an answer; with nothing answering it closes the panel.
- `Enter` sends and `Shift+Enter` adds a line.
- `Ctrl+Alt+/` (`⌘⌥/` on a Mac) opens the model list; arrow keys move and `Enter` picks.

Motion uses opacity and transform only, with ease-out `cubic-bezier(0.23, 1, 0.32, 1)` for things entering and leaving and `cubic-bezier(0.77, 0, 0.175, 1)` for things moving on screen, at most 260 ms. The panel fades and slides 12 px in 220 ms and leaves in 160 ms; a question rises 8 px in 180 ms; words of an answer fade in over 150 ms as they arrive; the step in progress has a 1.6 s sweep; an approval card rises 6 px and folds in 200 ms, the only height animation. Anything opened from the keyboard appears without a slide. With reduced motion, slides and rises are dropped, fades stay and the sweep stops. Transcript text, the playback highlight and answers already on screen never animate. The transcript column makes room for the panel by changing its padding over 260 ms rather than with a transform, because a transform would detach the fixed player bar inside it.
