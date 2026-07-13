const queues = new Map<string, Promise<void>>();

/**
 * Serializes async writes sharing the same key so rapid clicks on the same
 * row can't land out of order, while writes for different keys still run
 * in parallel. Callers await the result to know whether to revert an
 * optimistic update.
 */
export function queueWrite(key: string, task: () => Promise<void>): Promise<void> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  queues.set(key, run.catch(() => {}));
  return run;
}
