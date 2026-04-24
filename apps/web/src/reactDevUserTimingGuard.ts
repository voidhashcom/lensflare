const REACT_COMPONENT_MEASURE_PREFIX = "\u200b";

let hasWarnedAboutReactTimingCloneFailure = false;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReactDevtoolsMeasure(name: string, options: unknown): boolean {
  if (name.startsWith(REACT_COMPONENT_MEASURE_PREFIX)) {
    return true;
  }

  if (!isObject(options) || !isObject(options.detail)) {
    return false;
  }

  return isObject(options.detail.devtools);
}

function isStructuredCloneFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "DataCloneError") {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "DataCloneError" || error.message.includes("Data cannot be cloned");
}

/**
 * React 19's development build records component timing entries with a
 * DevTools prop diff in `PerformanceMeasure.detail`. Large log-stream props
 * can exceed Electron/Chromium's structured-clone limit and throw from
 * `performance.measure`, which otherwise crashes the renderer during commit.
 *
 * Keep the native API for everything except those React DevTools entries when
 * Chromium refuses to clone their metadata.
 */
export function installReactDevUserTimingGuard(performanceApi: Performance = performance): void {
  const originalMeasure = performanceApi.measure.bind(performanceApi);

  performanceApi.measure = ((
    measureName: string,
    startOrOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ) => {
    try {
      return originalMeasure(measureName, startOrOptions as PerformanceMeasureOptions, endMark);
    } catch (error) {
      if (isReactDevtoolsMeasure(measureName, startOrOptions) && isStructuredCloneFailure(error)) {
        if (!hasWarnedAboutReactTimingCloneFailure) {
          hasWarnedAboutReactTimingCloneFailure = true;
          console.warn(
            "React DevTools performance metadata was too large to clone; skipped the timing entry.",
          );
        }
        return undefined as unknown as PerformanceMeasure;
      }

      throw error;
    }
  }) as Performance["measure"];
}

if (
  import.meta.env.DEV &&
  typeof performance !== "undefined" &&
  typeof performance.measure === "function"
) {
  installReactDevUserTimingGuard();
}
