const defineValue = <T extends object, K extends PropertyKey>(
  target: T,
  key: K,
  value: unknown,
) => {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: false,
    writable: true,
    value,
  });
};

const installArrayAt = () => {
  if (typeof Array.prototype.at === 'function') return;
  defineValue(Array.prototype, 'at', function at<T>(this: T[], index: number) {
    const length = this.length >>> 0;
    let normalized = Number(index) || 0;
    if (normalized < 0) normalized += length;
    if (normalized < 0 || normalized >= length) return undefined;
    return this[normalized];
  });
};

const installArrayFindLast = () => {
  if (typeof Array.prototype.findLast === 'function') return;
  defineValue(
    Array.prototype,
    'findLast',
    function findLast<T>(
      this: T[],
      predicate: (value: T, index: number, array: T[]) => boolean,
      thisArg?: unknown,
    ) {
      if (typeof predicate !== 'function') {
        throw new TypeError('Array.prototype.findLast predicate must be a function');
      }
      for (let index = this.length - 1; index >= 0; index -= 1) {
        const value = this[index];
        if (predicate.call(thisArg, value, index, this)) {
          return value;
        }
      }
      return undefined;
    },
  );
};

const installArrayFindLastIndex = () => {
  if (typeof Array.prototype.findLastIndex === 'function') return;
  defineValue(
    Array.prototype,
    'findLastIndex',
    function findLastIndex<T>(
      this: T[],
      predicate: (value: T, index: number, array: T[]) => boolean,
      thisArg?: unknown,
    ) {
      if (typeof predicate !== 'function') {
        throw new TypeError('Array.prototype.findLastIndex predicate must be a function');
      }
      for (let index = this.length - 1; index >= 0; index -= 1) {
        if (predicate.call(thisArg, this[index], index, this)) {
          return index;
        }
      }
      return -1;
    },
  );
};

const flattenInto = <T>(
  result: T[],
  value: T | T[] | readonly T[],
  depth: number,
) => {
  if (Array.isArray(value) && depth > 0) {
    value.forEach((entry) => flattenInto(result, entry as T | T[] | readonly T[], depth - 1));
    return;
  }
  result.push(value as T);
};

const installArrayFlat = () => {
  if (typeof Array.prototype.flat === 'function') return;
  defineValue(Array.prototype, 'flat', function flat<T>(this: T[], depth?: number) {
    const normalizedDepth = depth == null ? 1 : Math.max(0, Math.floor(Number(depth) || 0));
    const result: T[] = [];
    this.forEach((value) => flattenInto(result, value as T | T[] | readonly T[], normalizedDepth));
    return result;
  });
};

const installArrayFlatMap = () => {
  if (typeof Array.prototype.flatMap === 'function') return;
  defineValue(
    Array.prototype,
    'flatMap',
    function flatMap<T, U>(
      this: T[],
      mapper: (value: T, index: number, array: T[]) => U | U[],
      thisArg?: unknown,
    ) {
      if (typeof mapper !== 'function') {
        throw new TypeError('Array.prototype.flatMap mapper must be a function');
      }
      const result: U[] = [];
      this.forEach((value, index) => {
        flattenInto(result, mapper.call(thisArg, value, index, this) as U | U[], 1);
      });
      return result;
    },
  );
};

const installObjectFromEntries = () => {
  if (typeof Object.fromEntries === 'function') return;
  defineValue(Object, 'fromEntries', function fromEntries<K extends PropertyKey, V>(
    entries: Iterable<readonly [K, V]>,
  ) {
    const output: Record<PropertyKey, V> = {};
    for (const [key, value] of entries) {
      output[key] = value;
    }
    return output;
  });
};

const installObjectHasOwn = () => {
  if (typeof Object.hasOwn === 'function') return;
  defineValue(Object, 'hasOwn', function hasOwn(target: object, key: PropertyKey) {
    return Object.prototype.hasOwnProperty.call(target, key);
  });
};

const installStringReplaceAll = () => {
  if (typeof String.prototype.replaceAll === 'function') return;
  defineValue(
    String.prototype,
    'replaceAll',
    function replaceAll(this: string, searchValue: string | RegExp, replaceValue: string) {
      if (searchValue instanceof RegExp) {
        if (!searchValue.global) {
          throw new TypeError('String.prototype.replaceAll called with a non-global RegExp');
        }
        return this.replace(searchValue, replaceValue);
      }
      return this.split(String(searchValue)).join(replaceValue);
    },
  );
};

export const installRuntimePolyfills = () => {
  installArrayAt();
  installArrayFindLast();
  installArrayFindLastIndex();
  installArrayFlat();
  installArrayFlatMap();
  installObjectFromEntries();
  installObjectHasOwn();
  installStringReplaceAll();
};

installRuntimePolyfills();
