import { Storage } from "@google-cloud/storage";
import { config } from "../config";
import { log } from "../utils/logger";

let storageClient: Storage | null = null;

function getStorageClient(): Storage {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
}

function getExtensionFromContentType(contentType: string): string {
  const extensionMap: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/webm": "webm",
  };
  return extensionMap[contentType] || "ogg";
}

export function getDeterministicAudioKey(agencyId: string, messageSid: string, extension: string): string {
  return `${config.objectStorage.privateDir}/audio/${agencyId}/${messageSid}.${extension}`;
}

export async function checkAudioExists(objectKey: string): Promise<boolean> {
  if (!config.objectStorage.bucketId) {
    return false;
  }

  try {
    const client = getStorageClient();
    const bucket = client.bucket(config.objectStorage.bucketId);
    const file = bucket.file(objectKey);
    const [exists] = await file.exists();
    
    if (exists) {
      const [metadata] = await file.getMetadata();
      const size = parseInt(metadata.size as string, 10) || 0;
      return size > 0;
    }
    return false;
  } catch (err) {
    log.debug("Error checking audio exists", { objectKey, error: String(err) });
    return false;
  }
}

export async function uploadAudio(
  audioBuffer: Buffer,
  agencyId: string,
  messageSid: string,
  contentType: string
): Promise<string> {
  const extension = getExtensionFromContentType(contentType);
  const objectKey = getDeterministicAudioKey(agencyId, messageSid, extension);

  const exists = await checkAudioExists(objectKey);
  if (exists) {
    log.info("Audio already exists, skipping upload", { objectKey });
    return objectKey;
  }

  if (!config.objectStorage.bucketId) {
    throw new Error("Object storage bucket not configured");
  }

  const client = getStorageClient();
  const bucket = client.bucket(config.objectStorage.bucketId);
  const file = bucket.file(objectKey);

  await file.save(audioBuffer, {
    contentType,
    resumable: false,
  });

  log.info("Audio uploaded to object storage", { objectKey, size: audioBuffer.length });
  return objectKey;
}

export async function downloadAudio(objectKey: string): Promise<Buffer> {
  if (!config.objectStorage.bucketId) {
    throw new Error("Object storage bucket not configured");
  }

  const client = getStorageClient();
  const bucket = client.bucket(config.objectStorage.bucketId);
  const file = bucket.file(objectKey);

  const [contents] = await file.download();
  log.info("Audio downloaded from object storage", { objectKey, size: contents.length });
  return contents;
}
