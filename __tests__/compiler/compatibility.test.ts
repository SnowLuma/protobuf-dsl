import { describe, expect, it } from 'vitest';
import { run, imports } from '../compile';
import { bundle } from '../project';
import { schemaCodecs } from '../schema';
import { packageName } from '../../src/package';
import type { pb_optional, uint_32 } from '../../protobuf';

describe('explicit field presence', () => {
  const defaults: [string, unknown, number[]][] = [
    ['uint_32', 0, [8, 0]],
    ['int_32', 0, [8, 0]],
    ['sint_32', 0, [8, 0]],
    ['bool', false, [8, 0]],
    ['string', '', [10, 0]],
    ['bytes', new Uint8Array(), [10, 0]],
    ['uint_64', 0n, [8, 0]],
    ['int_64', 0n, [8, 0]],
    ['sint_64', 0n, [8, 0]],
    ['float', 0, [13, 0, 0, 0, 0]],
    ['double', 0, [9, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['fixed_32', 0, [13, 0, 0, 0, 0]],
    ['sfixed_32', 0, [13, 0, 0, 0, 0]],
    ['fixed_64', 0n, [9, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['sfixed_64', 0n, [9, 0, 0, 0, 0, 0, 0, 0, 0]],
  ];

  it.each(defaults)('preserves a present %s default only with pb_optional', (type, value, wire) => {
    const explicit = schemaCodecs<{ value?: unknown }>(`interface Msg {value?:pb_optional<1,${type}>;}`);
    const ordinary = schemaCodecs<{ value?: unknown }>(`interface Msg {value?:pb<1,${type}>;}`);
    expect([...explicit.encode({ value })]).toEqual(wire);
    expect(explicit.decode(new Uint8Array(wire))).toEqual({ value });
    expect(ordinary.encode({ value })).toEqual(new Uint8Array());
    for (const absent of [{}, { value: null }, { value: undefined }]) {
      expect(explicit.encode(absent)).toEqual(new Uint8Array());
      expect(ordinary.encode(absent)).toEqual(new Uint8Array());
    }
    expect(explicit.decode(new Uint8Array())).toEqual({ value: null });
  });

  it('exports the marker and keeps nullable plain fields separate from wire presence', () => {
    const explicit = schemaCodecs<{ value?: pb_optional<1, uint_32> | null }>(
      'interface Msg {value:pb_optional<1,uint_32> | null;}',
    );
    const ordinary = schemaCodecs<{ value: number | null }>('interface Msg {value:pb<1,uint_32> | null;}');
    expect([...explicit.encode({ value: 0 })]).toEqual([8, 0]);
    expect(ordinary.encode({ value: 0 })).toEqual(new Uint8Array());
    expect(explicit.decode(new Uint8Array())).toEqual({ value: null });
  });

  it('distinguishes marker kinds when caching generic instantiations', () => {
    expect(
      run(`
      interface Box<T> {value:T;}
      export const result = [
        [...protobuf_encode<Box<pb<1,uint_32>>>({value:0})],
        [...protobuf_encode<Box<pb_optional<1,uint_32>>>({value:0})],
        [...protobuf_encode<Box<pb_repeated<1,uint_32>>>({value:[0,7]})],
      ];
    `).result,
    ).toEqual([[], [8, 0], [8, 0, 8, 7]]);
  });

  it('preserves aliased and namespace markers through nested generic wrappers', async () => {
    expect(
      await bundle({
        'schema.ts': `import type {pb_optional as O, uint_32} from '${packageName}';
        import type * as p from '${packageName}';
        export interface Msg {value?:O<1,uint_32>;}
        export interface Box<T> {value?:p.pb_optional<1,T>;}`,
        'barrel.ts': `export * from './schema';`,
        'wrapper.ts': `${imports} import type {Box} from './barrel';
        export function encode<T>(value:Box<T>) {return protobuf_encode<Box<T>>(value);}`,
        'entry.ts': `import {encode} from './wrapper'; import type {Msg} from './barrel';
        export const result = [...encode<Msg>({value:{value:0}})];`,
      }),
    ).toEqual({ result: [10, 2, 8, 0] });
  });
});

describe('int32 wire compatibility', () => {
  const codec = schemaCodecs<{ value: number }>('interface Msg {value:pb<1,int_32>;}');
  const negatives: [number, number[], number[]][] = [
    [-1, [255, 255, 255, 255, 15], [255, 255, 255, 255, 255, 255, 255, 255, 255, 1]],
    [-2, [254, 255, 255, 255, 15], [254, 255, 255, 255, 255, 255, 255, 255, 255, 1]],
    [-2147483648, [128, 128, 128, 128, 8], [128, 128, 128, 128, 248, 255, 255, 255, 255, 1]],
  ];

  it.each(negatives)('encodes %i in ten bytes and accepts both wire forms', (value, legacy, canonical) => {
    expect([...codec.encode({ value })]).toEqual([8, ...canonical]);
    expect(codec.decode(new Uint8Array([8, ...legacy]))).toEqual({ value });
    expect(codec.decode(new Uint8Array([8, ...canonical]))).toEqual({ value });
  });

  it('uses correct lengths for nested and repeated negative values', () => {
    const nested = schemaCodecs<{ inner: { values: number[] } }>(`
      interface Inner {values:pb_repeated<1,int_32>;}
      interface Msg {inner:pb<1,Inner>;}
    `);
    const values = [-1, -2147483648, 0];
    const wire = [
      10, 24, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 8, 128, 128, 128, 128, 248, 255, 255, 255,
      255, 1, 8, 0,
    ];
    expect([...nested.encode({ inner: { values } })]).toEqual(wire);
    expect(nested.decode(new Uint8Array(wire))).toEqual({ inner: { values } });
    const packed = [10, 13, 10, 11, 255, 255, 255, 255, 15, 128, 128, 128, 128, 8, 0];
    expect(nested.decode(new Uint8Array(packed))).toEqual({ inner: { values } });
  });

  it('continues to sign-extend negative int64 values', () => {
    const wide = schemaCodecs<{ value: bigint }>('interface Msg {value:pb<1,int_64>;}');
    expect([...wide.encode({ value: -1n })]).toEqual([8, ...Array(9).fill(255), 1]);
  });
});
