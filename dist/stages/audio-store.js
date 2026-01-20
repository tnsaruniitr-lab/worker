"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processAudioStore = processAudioStore;
const twilio_1 = require("../services/twilio");
const storage_1 = require("../services/storage");
const claim_1 = require("../claim");
const logger_1 = require("../utils/logger");
async function processAudioStore(message) {
    const { messageSid, mediaUrl, mediaBlobId, agencyId } = message;
    if (mediaBlobId) {
        logger_1.log.info("Audio already stored, skipping", { messageSid, mediaBlobId });
        return { success: true, mediaBlobId };
    }
    if (!mediaUrl) {
        logger_1.log.warn("No media URL available", { messageSid });
        return { success: false, mediaBlobId: null, error: "No media URL" };
    }
    try {
        const { buffer, contentType } = await (0, twilio_1.downloadMediaFromTwilio)(mediaUrl);
        const objectKey = await (0, storage_1.uploadAudio)(buffer, agencyId, messageSid, contentType);
        await (0, claim_1.updateMessageAudioStored)(messageSid, objectKey);
        logger_1.log.info("Audio store stage complete", { messageSid, objectKey });
        return { success: true, mediaBlobId: objectKey };
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger_1.log.error("Audio store stage failed", { messageSid, error: errorMsg });
        return { success: false, mediaBlobId: null, error: errorMsg };
    }
}
//# sourceMappingURL=audio-store.js.map