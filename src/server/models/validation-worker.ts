import { getAvailableBackendsAsync, TranscribeModel, version } from "transcribe-cpp";

try {
  const path = process.argv[2];
  const devices = await getAvailableBackendsAsync();
  const device = devices.find((entry) => entry.deviceType === "cpu");
  if (!device) throw new Error("No CPU inference backend is available.");
  if (path && path !== "--probe") {
    const model = await TranscribeModel.load(path, { device });
    try {
      if (
        model.arch !== "parakeet" ||
        !model.roles.includes("asr") ||
        model.capabilities.maxTimestampKind === "none"
      )
        throw new Error(
          "This model does not provide the expected transcription and timestamp capabilities.",
        );
    } finally {
      model.dispose();
    }
  }
  console.log(`MOVO_MODEL:${JSON.stringify({ engineVersion: version().version })}`);
} catch (cause) {
  console.error(
    `ERROR: ${cause instanceof Error ? cause.message : "Could not load the transcription engine."}`,
  );
  process.exitCode = 1;
}
