export const flatMapCompat = <T, U>(
  values: readonly T[],
  project: (value: T, index: number, array: readonly T[]) => readonly U[],
): U[] =>
  values.reduce<U[]>((acc, value, index, array) => {
    const next = project(value, index, array);
    if (Array.isArray(next) && next.length > 0) {
      acc.push(...next);
    }
    return acc;
  }, []);
