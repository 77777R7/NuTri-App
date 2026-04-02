export type GoalNavigatorBundleSource = "storage" | "disk" | "live";

export type GoalNavigatorBundleObservabilitySnapshot = {
  currentBundle: {
    source: GoalNavigatorBundleSource | null;
    activeRunId: string | null;
    generatedAt: string | null;
    loadedAt: string | null;
    storageBucket: string | null;
    storagePath: string | null;
    artifactPath: string | null;
  };
  counters: {
    storageHits: number;
    diskHits: number;
    liveHits: number;
    liveBuildCount: number;
    precomputedMissCount: number;
    fallbackToLiveBuildCount: number;
    totalLoads: number;
    precomputedHitRate: number;
  };
  lastErrors: {
    storage: string | null;
    disk: string | null;
  };
};

type MutableGoalNavigatorBundleObservabilityState = {
  currentBundle: GoalNavigatorBundleObservabilitySnapshot["currentBundle"];
  counters: Omit<GoalNavigatorBundleObservabilitySnapshot["counters"], "totalLoads" | "precomputedHitRate">;
  lastErrors: GoalNavigatorBundleObservabilitySnapshot["lastErrors"];
};

const createDefaultState = (): MutableGoalNavigatorBundleObservabilityState => ({
  currentBundle: {
    source: null,
    activeRunId: null,
    generatedAt: null,
    loadedAt: null,
    storageBucket: null,
    storagePath: null,
    artifactPath: null,
  },
  counters: {
    storageHits: 0,
    diskHits: 0,
    liveHits: 0,
    liveBuildCount: 0,
    precomputedMissCount: 0,
    fallbackToLiveBuildCount: 0,
  },
  lastErrors: {
    storage: null,
    disk: null,
  },
});

let STATE = createDefaultState();

const nowIso = () => new Date().toISOString();

export const recordGoalNavigatorBundleLoad = (input: {
  source: GoalNavigatorBundleSource;
  generatedAt: string;
  activeRunId?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  artifactPath?: string | null;
}) => {
  if (input.source === "storage") {
    STATE.counters.storageHits += 1;
  } else if (input.source === "disk") {
    STATE.counters.diskHits += 1;
  } else {
    STATE.counters.liveHits += 1;
  }

  STATE.currentBundle = {
    source: input.source,
    activeRunId: input.activeRunId ?? null,
    generatedAt: input.generatedAt,
    loadedAt: nowIso(),
    storageBucket: input.storageBucket ?? null,
    storagePath: input.storagePath ?? null,
    artifactPath: input.artifactPath ?? null,
  };
};

export const recordGoalNavigatorLiveBuild = (input: { generatedAt: string }) => {
  STATE.counters.liveBuildCount += 1;
  STATE.counters.fallbackToLiveBuildCount += 1;
  STATE.currentBundle = {
    source: "live",
    activeRunId: null,
    generatedAt: input.generatedAt,
    loadedAt: nowIso(),
    storageBucket: null,
    storagePath: null,
    artifactPath: null,
  };
};

export const recordGoalNavigatorPrecomputedMiss = () => {
  STATE.counters.precomputedMissCount += 1;
};

export const updateGoalNavigatorBundleDiagnostics = (input: {
  storageError?: string | null;
  diskError?: string | null;
}) => {
  if (input.storageError !== undefined) {
    STATE.lastErrors.storage = input.storageError ?? null;
  }
  if (input.diskError !== undefined) {
    STATE.lastErrors.disk = input.diskError ?? null;
  }
};

export const getGoalNavigatorBundleObservabilitySnapshot =
  (): GoalNavigatorBundleObservabilitySnapshot => {
    const totalLoads =
      STATE.counters.storageHits + STATE.counters.diskHits + STATE.counters.liveHits;
    const precomputedHits = STATE.counters.storageHits + STATE.counters.diskHits;

    return {
      currentBundle: {
        ...STATE.currentBundle,
      },
      counters: {
        ...STATE.counters,
        totalLoads,
        precomputedHitRate: totalLoads > 0 ? precomputedHits / totalLoads : 0,
      },
      lastErrors: {
        ...STATE.lastErrors,
      },
    };
  };

export const goalNavigatorBundleObservabilityInternals = {
  reset: () => {
    STATE = createDefaultState();
  },
};
