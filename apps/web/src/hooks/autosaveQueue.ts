// Serialize writes so a slow older autosave cannot overwrite a newer one.
export function createAutosaveQueue() {
  let tail: Promise<void> = Promise.resolve();

  return (save: () => Promise<void>): Promise<void> => {
    const pending = tail.then(save);
    // A failed write must be visible to its caller but must not poison
    // later edits or an explicit retry before downloading.
    tail = pending.catch(() => undefined);
    return pending;
  };
}
