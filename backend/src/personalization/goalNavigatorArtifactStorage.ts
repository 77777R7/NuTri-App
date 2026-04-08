import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import zlib from "node:zlib";

import { supabase } from "../supabase.js";
import {
  parseGoalNavigatorCandidateBundleArtifact,
  type GoalNavigatorCatalogBundleArtifact,
} from "./goalNavigatorBundleArtifact.js";

export const GOAL_NAVIGATOR_ARTIFACT_STORAGE_BUCKET = "personalization-artifacts";
const GOAL_NAVIGATOR_ARTIFACT_STORAGE_PREFIX = "goal-navigator";

export type GoalNavigatorArtifactStorageLocation = {
  bucket: string;
  path: string;
  byteSize: number;
  checksum: string;
};

const sanitizePathSegment = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export const serializeGoalNavigatorCandidateBundleArtifact = (
  artifact: GoalNavigatorCatalogBundleArtifact,
) => `${JSON.stringify(artifact, null, 2)}\n`;

export const computeGoalNavigatorCandidateBundleChecksum = (body: string) =>
  crypto.createHash("sha256").update(body).digest("hex");

export const buildGoalNavigatorArtifactStoragePath = (
  artifact: Pick<GoalNavigatorCatalogBundleArtifact, "generatedAt" | "schemaVersion" | "rulesVersion">,
) => {
  const generatedAt = sanitizePathSegment(artifact.generatedAt.replace(/:/g, "-"));
  const schemaVersion = sanitizePathSegment(artifact.schemaVersion);
  const rulesVersion = sanitizePathSegment(artifact.rulesVersion);
  return `${GOAL_NAVIGATOR_ARTIFACT_STORAGE_PREFIX}/${generatedAt}__${schemaVersion}__${rulesVersion}.json.gz`;
};

const gzipGoalNavigatorCandidateBundleArtifact = (body: string) =>
  zlib.gzipSync(Buffer.from(body, "utf8"), {
    level: zlib.constants.Z_BEST_COMPRESSION,
  });

const inflateDownloadedArtifactBody = async (params: {
  data: Blob;
  path: string;
}): Promise<string> => {
  const buffer = Buffer.from(await params.data.arrayBuffer());
  if (params.path.endsWith(".gz")) {
    return zlib.gunzipSync(buffer).toString("utf8");
  }

  return typeof params.data.text === "function" ? await params.data.text() : buffer.toString("utf8");
};

export const uploadGoalNavigatorCandidateBundleArtifact = async (
  artifact: GoalNavigatorCatalogBundleArtifact,
): Promise<GoalNavigatorArtifactStorageLocation> => {
  await ensureGoalNavigatorArtifactStorageBucket();
  const body = serializeGoalNavigatorCandidateBundleArtifact(artifact);
  const compressedBody = gzipGoalNavigatorCandidateBundleArtifact(body);
  const path = buildGoalNavigatorArtifactStoragePath(artifact);
  const { error } = await supabase.storage
    .from(GOAL_NAVIGATOR_ARTIFACT_STORAGE_BUCKET)
    .upload(path, compressedBody, {
      contentType: "application/gzip",
      upsert: true,
    });

  if (error) {
    throw error;
  }

  return {
    bucket: GOAL_NAVIGATOR_ARTIFACT_STORAGE_BUCKET,
    path,
    byteSize: compressedBody.byteLength,
    checksum: computeGoalNavigatorCandidateBundleChecksum(body),
  };
};

export const ensureGoalNavigatorArtifactStorageBucket = async (): Promise<void> => {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    throw error;
  }

  if (Array.isArray(data) && data.some((bucket) => bucket.id === GOAL_NAVIGATOR_ARTIFACT_STORAGE_BUCKET)) {
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(
    GOAL_NAVIGATOR_ARTIFACT_STORAGE_BUCKET,
    {
      public: false,
    },
  );
  if (
    createError &&
    !/already exists/i.test(createError.message) &&
    !/duplicate/i.test(createError.message)
  ) {
    throw createError;
  }
};

export const downloadGoalNavigatorCandidateBundleArtifact = async (
  location: Pick<GoalNavigatorArtifactStorageLocation, "bucket" | "path">,
): Promise<{
  artifact: GoalNavigatorCatalogBundleArtifact | null;
  body: string | null;
  error: string | null;
}> => {
  const { data, error } = await supabase.storage.from(location.bucket).download(location.path);
  if (error) {
    return {
      artifact: null,
      body: null,
      error: error.message,
    };
  }

  const body = await inflateDownloadedArtifactBody({
    data,
    path: location.path,
  });
  const artifact = parseGoalNavigatorCandidateBundleArtifact(JSON.parse(body));

  return {
    artifact,
    body,
    error: artifact ? null : "invalid_goal_navigator_candidate_bundle",
  };
};

export const goalNavigatorArtifactStorageInternals = {
  buildGoalNavigatorArtifactStoragePath,
  computeGoalNavigatorCandidateBundleChecksum,
  ensureGoalNavigatorArtifactStorageBucket,
  gzipGoalNavigatorCandidateBundleArtifact,
  inflateDownloadedArtifactBody,
  serializeGoalNavigatorCandidateBundleArtifact,
};
