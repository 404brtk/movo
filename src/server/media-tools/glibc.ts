import { Result, Schema } from "effect";

const ProcessReport = Schema.Struct({
  header: Schema.Struct({ glibcVersionRuntime: Schema.String }),
});

export function hasGlibc(requiredMajor: number, requiredMinor: number) {
  if (process.platform !== "linux") return false;
  const report = Schema.decodeUnknownResult(ProcessReport)(process.report.getReport());
  if (Result.isFailure(report)) return false;
  const [major = 0, minor = 0] = report.success.header.glibcVersionRuntime.split(".").map(Number);
  return major > requiredMajor || (major === requiredMajor && minor >= requiredMinor);
}
