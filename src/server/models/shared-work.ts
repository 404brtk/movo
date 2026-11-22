export function shareWork<T>(start: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const result = start(controller.signal);
  let waiters = 0;
  return {
    abandoned: () => controller.signal.aborted,
    join: (signal: AbortSignal) =>
      new Promise<T>((resolve, reject) => {
        let waiting = true;
        const leave = () => {
          waiting = false;
          waiters--;
          signal.removeEventListener("abort", abandon);
        };
        const abandon = () => {
          if (!waiting) return;
          leave();
          if (waiters === 0) controller.abort(signal.reason);
          reject(signal.reason);
        };
        waiters++;
        signal.addEventListener("abort", abandon, { once: true });
        if (signal.aborted) abandon();
        result.then(
          (value) => {
            if (!waiting) return undefined;
            leave();
            resolve(value);
            return undefined;
          },
          (cause: unknown) => {
            if (!waiting) return;
            leave();
            reject(cause);
          },
        );
      }),
  };
}
