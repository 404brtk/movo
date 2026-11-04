import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { tryLock } from "fs-native-extensions";

export function acquireDataDirectory(directory: string) {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        await mkdir(directory, { recursive: true });
        const file = await open(join(directory, "instance.lock"), "a+");
        try {
          if (!tryLock(file.fd))
            throw new Error(
              "Another Movo backend is already using this data directory. Stop it or choose a different MOVO_DATA_DIR.",
            );
          return file;
        } catch (cause) {
          await file.close();
          throw cause;
        }
      },
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : new Error("Could not lock Movo's data directory.", { cause }),
    }),
    (file) => Effect.promise(() => file.close()),
  );
}
