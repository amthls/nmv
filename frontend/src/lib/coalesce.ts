/**
 * Folds a burst of calls into few (Plan/load-and-layout.md D1): the first call runs right away, calls during the next
 * `ms` become one trailing call, and so on while the burst lasts. When several calls were folded, the trailing call
 * gets `undefined` instead of the last argument (= "anything may have changed").
 */
export function coalesce<T>(run: (arg: T | undefined) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiting = 0;
  let last: T | undefined;
  const flush = () => {
    timer = null;
    if (waiting === 0) return;
    const arg = waiting === 1 ? last : undefined;
    waiting = 0;
    run(arg);
    timer = setTimeout(flush, ms);
  };
  return {
    push(arg: T) {
      waiting++;
      last = arg;
      if (!timer) flush();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      waiting = 0;
    },
  };
}
