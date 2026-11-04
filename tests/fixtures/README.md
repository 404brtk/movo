# Local media fixtures

`tone.wav` is a two-second 440 Hz tone, mono 8 kHz PCM. `sample.webm` is a two-second blue frame with the same tone, using VP8 and Opus. Both were generated for these tests; they contain no external recordings.

Regenerate from the repository root with FFmpeg:

```sh
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=8000:duration=2 -c:a pcm_s16le -map_metadata -1 tests/fixtures/tone.wav
ffmpeg -f lavfi -i color=c=0x2457d6:s=160x90:r=10:d=2 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=2 -c:v libvpx -b:v 100k -c:a libopus -b:a 32k -shortest -map_metadata -1 tests/fixtures/sample.webm
```

Ordinary integration and browser tests use the committed files and local FFprobe. They do not download media or models.
