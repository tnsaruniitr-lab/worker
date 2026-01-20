"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processTranscribe = processTranscribe;
const storage_1 = require("../services/storage");
const twilio_1 = require("../services/twilio");
const openai_1 = require("../services/openai");
const claim_1 = require("../claim");
const logger_1 = require("../utils/logger");
async function processTranscribe(message, mediaBlobId) {
    const { messageSid, mediaUrl, transcriptText: existingTranscript } = message;
    if (existingTranscript) {
        logger_1.log.info("Transcript already exists, skipping", { messageSid });
        return { success: true, transcriptText: existingTranscript };
    }
    try {
        let audioBuffer;
        if (mediaBlobId) {
            logger_1.log.info("Loading audio from object storage", { messageSid, mediaBlobId });
            audioBuffer = await (0, storage_1.downloadAudio)(mediaBlobId);
        }
        else if (mediaUrl) {
            logger_1.log.info("Fallback: downloading audio from Twilio", { messageSid });
            const { buffer } = await (0, twilio_1.downloadMediaFromTwilio)(mediaUrl);
            audioBuffer = buffer;
        }
        else {
            return { success: false, transcriptText: null, error: "No audio source available" };
        }
        const transcript = await (0, openai_1.transcribeAudio)(audioBuffer);
        await (0, claim_1.updateMessageTranscribed)(messageSid, transcript);
        logger_1.log.info("Transcribe stage complete", { messageSid, transcriptLength: transcript.length });
        return { success: true, transcriptText: transcript };
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger_1.log.error("Transcribe stage failed", { messageSid, error: errorMsg });
        return { success: false, transcriptText: null, error: errorMsg };
    }
}
//# sourceMappingURL=transcribe.js.map