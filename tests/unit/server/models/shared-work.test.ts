import { expect, it } from "vitest";
import { shareWork } from "../../../../src/server/models/shared-work.ts";

function controlledWork() {
  const control: { finish?: (value: string) => void; signal?: AbortSignal } = {};
  const work = shareWork(
    (signal) =>
      new Promise<string>((resolve) => {
        control.signal = signal;
        control.finish = resolve;
      }),
  );
  return { work, control };
}

it("stops waiting for one caller at once while the others still get the result", async () => {
  const { work, control } = controlledWork();
  const cancelled = new AbortController();
  const cancelledWait = work.join(cancelled.signal);
  const otherWait = work.join(new AbortController().signal);
  cancelled.abort(new Error("Cancelled."));
  await expect(cancelledWait).rejects.toThrow("Cancelled.");
  expect(control.signal?.aborted).toBe(false);
  expect(work.abandoned()).toBe(false);
  control.finish?.("verified");
  await expect(otherWait).resolves.toBe("verified");
});

it("stops the work once every caller has stopped waiting", async () => {
  const { work, control } = controlledWork();
  const first = new AbortController();
  const second = new AbortController();
  const firstWait = work.join(first.signal);
  const secondWait = work.join(second.signal);
  first.abort(new Error("First cancelled."));
  await expect(firstWait).rejects.toThrow("First cancelled.");
  expect(control.signal?.aborted).toBe(false);
  second.abort(new Error("Second cancelled."));
  await expect(secondWait).rejects.toThrow("Second cancelled.");
  expect(control.signal?.aborted).toBe(true);
  expect(work.abandoned()).toBe(true);
});

it("rejects a caller that has already stopped waiting", async () => {
  const { work } = controlledWork();
  await expect(work.join(AbortSignal.abort(new Error("Already cancelled.")))).rejects.toThrow(
    "Already cancelled.",
  );
  expect(work.abandoned()).toBe(true);
});
