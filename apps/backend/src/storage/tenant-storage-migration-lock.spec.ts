import { assertStorageMigrationFreeze, runWithStorageMigrationLock } from './tenant-storage-migration-lock';

describe('storage migration exclusive writer lock', () => {
  const initialFreeze = process.env.TENANCY_STORAGE_WRITES_STOPPED;
  const initialOperator = process.env.TENANCY_STORAGE_EXCLUSIVE_WRITER;
  const connect = jest.fn(async () => {});
  const release = jest.fn(async () => {});
  const query = jest.fn<Promise<{ acquired?: boolean; pid?: number; held?: boolean }[]>, [string, string[]?]>();
  const runner = { connect, release, query };
  beforeEach(() => {
    process.env.TENANCY_STORAGE_WRITES_STOPPED = 'true';
    process.env.TENANCY_STORAGE_EXCLUSIVE_WRITER = 'true';
    connect.mockClear();
    release.mockClear();
    query.mockReset();
  });
  afterAll(() => {
    if (initialFreeze === undefined) delete process.env.TENANCY_STORAGE_WRITES_STOPPED;
    else process.env.TENANCY_STORAGE_WRITES_STOPPED = initialFreeze;
    if (initialOperator === undefined) delete process.env.TENANCY_STORAGE_EXCLUSIVE_WRITER;
    else process.env.TENANCY_STORAGE_EXCLUSIVE_WRITER = initialOperator;
  });

  it.each(['TENANCY_STORAGE_WRITES_STOPPED', 'TENANCY_STORAGE_EXCLUSIVE_WRITER'])(
    'requires explicit %s before connecting or writing',
    async (name) => {
      delete process.env[name];
      expect(assertStorageMigrationFreeze).toThrow('one migration operator');
      await expect(runWithStorageMigrationLock(runner, 'tenant', async () => {})).rejects.toThrow('one migration operator');
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it('does not enter migration when another operator holds the tenant lock', async () => {
    query.mockResolvedValueOnce([{ acquired: false, pid: 42 }]);
    const run = jest.fn();
    await expect(runWithStorageMigrationLock(runner, 'tenant', run)).rejects.toThrow('Another storage migration');
    expect(run).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('holds one session and verifies ownership before every guarded write, then releases', async () => {
    query.mockResolvedValueOnce([{ acquired: true, pid: 42 }]).mockResolvedValue([{ pid: 42, held: true }]);
    const result = await runWithStorageMigrationLock(runner, 'tenant', async (assertWriter) => {
      await assertWriter();
      return 'done';
    });
    expect(result).toBe('done');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(['nervion-storage-migration', 'tenant']);
    expect(query.mock.calls[1][0]).toContain('FROM pg_locks');
    expect(query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    { pid: 43, held: true },
    { pid: 42, held: false },
  ])('rejects a lost or replaced lock session %j', async (status) => {
    query
      .mockResolvedValueOnce([{ acquired: true, pid: 42 }])
      .mockResolvedValueOnce([status])
      .mockResolvedValue([]);
    const run = jest.fn();
    await expect(runWithStorageMigrationLock(runner, 'tenant', run)).rejects.toThrow('connection was lost');
    expect(run).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the session if the copy fails without swallowing that failure', async () => {
    query.mockResolvedValueOnce([{ acquired: true, pid: 42 }]).mockResolvedValue([{ pid: 42, held: true }]);
    await expect(runWithStorageMigrationLock(runner, 'tenant', () => Promise.reject(new Error('copy failed')))).rejects.toThrow(
      'copy failed',
    );
    expect(release).toHaveBeenCalledTimes(1);
  });
});
