"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeterministicAudioKey = getDeterministicAudioKey;
exports.checkAudioExists = checkAudioExists;
exports.uploadAudio = uploadAudio;
exports.downloadAudio = downloadAudio;
const storage_1 = require("@google-cloud/storage");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
let storageClient = null;
function getStorageClient() {
    if (!storageClient) {
        storageClient = new storage_1.Storage();
    }
    return storageClient;
}
function getExtensionFromContentType(contentType) {
    const extensionMap = {
        "audio/ogg": "ogg",
        "audio/opus": "opus",
        "audio/mpeg": "mp3",
        "audio/mp4": "m4a",
        "audio/wav": "wav",
        "audio/webm": "webm",
    };
    return extensionMap[contentType] || "ogg";
}
function getDeterministicAudioKey(agencyId, messageSid, extension) {
    return `${config_1.config.objectStorage.privateDir}/audio/${agencyId}/${messageSid}.${extension}`;
}
async function checkAudioExists(objectKey) {
    if (!config_1.config.objectStorage.bucketId) {
        return false;
    }
    try {
        const client = getStorageClient();
        const bucket = client.bucket(config_1.config.objectStorage.bucketId);
        const file = bucket.file(objectKey);
        const [exists] = await file.exists();
        if (exists) {
            const [metadata] = await file.getMetadata();
            const size = parseInt(metadata.size, 10) || 0;
            return size > 0;
        }
        return false;
    }
    catch (err) {
        logger_1.log.debug("Error checking audio exists", { objectKey, error: String(err) });
        return false;
    }
}
async function uploadAudio(audioBuffer, agencyId, messageSid, contentType) {
    const extension = getExtensionFromContentType(contentType);
    const objectKey = getDeterministicAudioKey(agencyId, messageSid, extension);
    const exists = await checkAudioExists(objectKey);
    if (exists) {
        logger_1.log.info("Audio already exists, skipping upload", { objectKey });
        return objectKey;
    }
    if (!config_1.config.objectStorage.bucketId) {
        throw new Error("Object storage bucket not configured");
    }
    const client = getStorageClient();
    const bucket = client.bucket(config_1.config.objectStorage.bucketId);
    const file = bucket.file(objectKey);
    await file.save(audioBuffer, {
        contentType,
        resumable: false,
    });
    logger_1.log.info("Audio uploaded to object storage", { objectKey, size: audioBuffer.length });
    return objectKey;
}
async function downloadAudio(objectKey) {
    if (!config_1.config.objectStorage.bucketId) {
        throw new Error("Object storage bucket not configured");
    }
    const client = getStorageClient();
    const bucket = client.bucket(config_1.config.objectStorage.bucketId);
    const file = bucket.file(objectKey);
    const [contents] = await file.download();
    logger_1.log.info("Audio downloaded from object storage", { objectKey, size: contents.length });
    return contents;
}
//# sourceMappingURL=storage.js.map