/// <reference types="nativewind/types" />

declare module 'nativewind' {
  // NativeWind v4 ships minimal type metadata; declare styled to satisfy TS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function styled<T = any>(component: T): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function cssInterop(component: any, options: any): void;
}
