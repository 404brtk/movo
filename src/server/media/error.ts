export type MediaErrorReason =
  | "invalid"
  | "tooLarge"
  | "unsupported"
  | "notFound"
  | "unavailable"
  | "storage";

export class MediaError extends Error {
  readonly reason: MediaErrorReason;

  constructor(reason: MediaErrorReason, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "MediaError";
    this.reason = reason;
  }
}
