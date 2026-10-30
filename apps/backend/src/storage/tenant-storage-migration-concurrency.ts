export function storageCopyConcurrency(value: string | undefined): number {
  if (value === undefined) return 4;
  if (!/^[1-8]$/.test(value)) throw new Error('TENANCY_STORAGE_COPY_CONCURRENCY must be an integer from 1 to 8');
  return Number(value);
}

/** Stop claiming items after the first failure, but drain every started operation. */
export async function runStorageMigrationPage<T>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('Storage migration concurrency must be an integer from 1 to 8');
  }
  let next = 0;
  let failure: Error | undefined;
  const worker = async (): Promise<void> => {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try {
        await operation(items[index]);
      } catch (error) {
        if (!failure) failure = error instanceof Error ? error : new Error('Storage migration operation failed');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failure) throw failure;
}
