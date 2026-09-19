import { createAutosaveQueue } from './autosaveQueue';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('autosave ordering before PDF download', () => {
  it('waits for an older write before persisting and downloading the newest edit', async () => {
    const enqueue = createAutosaveQueue();
    const slow = deferred();
    const calls: string[] = [];
    let stored = 'initial';
    const older = enqueue(async () => {
      calls.push('older');
      await slow.promise;
      stored = 'old reference';
    });
    const latest = enqueue(async () => {
      calls.push('latest');
      stored = 'edited reference';
    });
    const download = latest.then(() => stored);
    await Promise.resolve();
    expect(calls).toEqual(['older']);
    expect(stored).toBe('initial');
    slow.resolve();
    await older;
    expect(await download).toBe('edited reference');
    expect(calls).toEqual(['older', 'latest']);
  });

  it('allows a later valid edit after an earlier autosave fails', async () => {
    const enqueue = createAutosaveQueue();
    const first = enqueue(async () => {
      throw new Error('temporary network error');
    });
    const rejection = expect(first).rejects.toThrow('temporary network error');
    let stored = '';
    const retry = enqueue(async () => {
      stored = 'saved after retry';
    });
    await rejection;
    await retry;
    expect(stored).toBe('saved after retry');
  });

  it('rejects the download prerequisite when the current snapshot cannot be saved', async () => {
    const enqueue = createAutosaveQueue();
    const download = jest.fn();
    const pending = enqueue(async () => {
      throw new Error('invalid reference');
    }).then(download);
    await expect(pending).rejects.toThrow('invalid reference');
    expect(download).not.toHaveBeenCalled();
  });
});
