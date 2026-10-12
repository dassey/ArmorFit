import { describe, expect, it } from 'vitest';
import type { FitWorkerApi } from '../workers/fit.worker';
import type { Remote } from '../workers/rpc';
import { FitPool } from './fitPool';

const fake = () => ({}) as Remote<FitWorkerApi>;

describe('FitPool', () => {
  it('spreads pieces across workers and keeps a group together', () => {
    const pool = new FitPool(fake, 3);
    expect([pool.indexOf('a'), pool.indexOf('b'), pool.indexOf('c')].sort()).toEqual([0, 1, 2]);
    const w = pool.indexOf('d', ['b']);
    expect(w).toBe(pool.indexOf('b'));
    expect(pool.indexOf('a')).toBe(pool.indexOf('a'));
    pool.release('a');
    expect(pool.indexOf('e')).toBe(0);
  });
});
