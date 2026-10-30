import { runStorageMigrationPage, storageCopyConcurrency } from './tenant-storage-migration-concurrency';

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('storage copy concurrency', () => {
  it('defaults to four and allows only integers from one to eight', () => {
    expect(storageCopyConcurrency(undefined)).toBe(4);
    for (const value of ['1', '4', '8']) expect(storageCopyConcurrency(value)).toBe(Number(value));
    for (const value of ['', '0', '9', '-1', '1.5', '4.0', '04', ' 4', 'Infinity', 'NaN']) {
      expect(() => storageCopyConcurrency(value)).toThrow('TENANCY_STORAGE_COPY_CONCURRENCY');
    }
  });

  it.each([1, 4, 8])('never starts more than %i operations and processes each item once', async (concurrency) => {
    const seen: number[] = [];
    let active = 0;
    let maximum = 0;
    await runStorageMigrationPage(
      Array.from({ length: 19 }, (_, index) => index),
      concurrency,
      async (item) => {
        active++;
        maximum = Math.max(maximum, active);
        seen.push(item);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active--;
      },
    );
    expect(maximum).toBe(concurrency);
    expect(active).toBe(0);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 19 }, (_, index) => index));
  });

  it('stops claiming work after failure and drains all started copies before rejection', async () => {
    const operations = [deferred(), deferred(), deferred()];
    const seen: number[] = [];
    const firstError = new Error('First S3 failure');
    let settled = false;
    let caught: Error | undefined;
    const running = runStorageMigrationPage([0, 1, 2, 3, 4, 5], 3, (item) => {
      seen.push(item);
      return operations[item].promise;
    })
      .catch((error: Error) => {
        caught = error;
      })
      .finally(() => {
        settled = true;
      });
    expect(seen).toEqual([0, 1, 2]);
    operations[0].reject(firstError);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    operations[1].resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(seen).toEqual([0, 1, 2]);
    operations[2].reject(new Error('Later failure'));
    await running;
    expect(caught).toBe(firstError);
    expect(seen).toEqual([0, 1, 2]);
  });

  it('handles synchronous failure without starting later operations', async () => {
    const operation = jest.fn(() => {
      throw new Error('Immediate failure');
    });
    await expect(runStorageMigrationPage([1, 2, 3], 3, operation)).rejects.toThrow('Immediate failure');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not call an operation for an empty page and rejects unsafe direct limits', async () => {
    const operation = jest.fn(async () => {});
    await runStorageMigrationPage([], 4, operation);
    expect(operation).not.toHaveBeenCalled();
    for (const concurrency of [0, 9, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(runStorageMigrationPage([1], concurrency, operation)).rejects.toThrow('concurrency');
    }
    expect(operation).not.toHaveBeenCalled();
  });
});
