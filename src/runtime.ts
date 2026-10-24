import { packageName } from './package.js';

function uncompiled(operation: string): never {
  throw new Error(
    `${operation}<T>() was not transformed by the ${packageName} Vite plugin. Add the plugin from ${packageName}/vite to your build.`,
  );
}

export function protobuf_encode<T>(_value: T): Uint8Array {
  return uncompiled('protobuf_encode');
}

export function protobuf_decode<T>(_bytes: Uint8Array): T {
  return uncompiled('protobuf_decode');
}
