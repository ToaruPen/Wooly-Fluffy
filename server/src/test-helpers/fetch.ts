/**
 * Create a fetch stub that never resolves — it rejects with an AbortError
 * when the signal fires, allowing tests to verify timeout / abort behavior.
 *
 * The returned function always sets `err.name = "AbortError"` on the
 * rejection, which is the canonical behavior per the Fetch spec.
 */
export const createAbortableNeverFetch = () => {
  return (_input: string, init?: { method?: string; signal?: AbortSignal }) =>
    new Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing_signal"));
        return;
      }
      if (signal.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        },
        { once: true },
      );
    });
};
