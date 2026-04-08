type ErrorUtilsShape = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

declare global {
  var ErrorUtils: ErrorUtilsShape | undefined;
  var __NUTRI_ERROR_DIAGNOSTICS_INSTALLED__: boolean | undefined;
}

const getRuntimeFeatureSnapshot = () => ({
  hasArrayAt: typeof Array.prototype.at === 'function',
  hasArrayFlat: typeof Array.prototype.flat === 'function',
  hasArrayFlatMap: typeof Array.prototype.flatMap === 'function',
  hasArrayFindLast: typeof (Array.prototype as Array<unknown> & { findLast?: unknown }).findLast === 'function',
  hasArrayFindLastIndex:
    typeof (Array.prototype as Array<unknown> & { findLastIndex?: unknown }).findLastIndex === 'function',
  hasObjectFromEntries: typeof Object.fromEntries === 'function',
  hasObjectHasOwn: typeof (Object as typeof Object & { hasOwn?: unknown }).hasOwn === 'function',
  hasStringReplaceAll:
    typeof (String.prototype as String & { replaceAll?: unknown }).replaceAll === 'function',
});

const installGlobalErrorDiagnostics = () => {
  if (globalThis.__NUTRI_ERROR_DIAGNOSTICS_INSTALLED__) return;
  globalThis.__NUTRI_ERROR_DIAGNOSTICS_INSTALLED__ = true;

  const errorUtils = globalThis.ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler?.();

  errorUtils?.setGlobalHandler?.((error, isFatal) => {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown JS exception';
    const stack =
      error instanceof Error && typeof error.stack === 'string'
        ? error.stack
        : typeof error === 'object' && error && 'stack' in error && typeof error.stack === 'string'
          ? error.stack
          : null;

    console.error('[NuTri][GlobalJSException]', {
      isFatal: Boolean(isFatal),
      message,
      stack,
      runtime: getRuntimeFeatureSnapshot(),
    });

    previousHandler?.(error, isFatal);
  });
};

installGlobalErrorDiagnostics();

export { installGlobalErrorDiagnostics };
