"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processMessage = processMessage;
const claim_1 = require("./claim");
const audio_store_1 = require("./stages/audio-store");
const transcribe_1 = require("./stages/transcribe");
const analyze_1 = require("./stages/analyze");
const create_doc_1 = require("./stages/create-doc");
const logger_1 = require("./utils/logger");
const STAGE_ORDER = [
    "RECEIVED",
    "AUDIO_STORED",
    "TRANSCRIBED",
    "ANALYZED",
    "DOC_CREATED",
    "NOTIF_QUEUED",
    "COMPLETED",
];
function stageIndex(stage) {
    return STAGE_ORDER.indexOf(stage);
}
function isHardFailureError(error) {
    const errorStr = String(error).toLowerCase();
    if (errorStr.includes("429") || errorStr.includes("rate limit")) {
        return true;
    }
    if (/5\d\d/.test(errorStr) || errorStr.includes("internal server error")) {
        return true;
    }
    if (errorStr.includes("etimedout") ||
        errorStr.includes("econnreset") ||
        errorStr.includes("econnrefused") ||
        errorStr.includes("timeout")) {
        return true;
    }
    return false;
}
async function processMessage(message) {
    const { messageSid, currentStage } = message;
    (0, logger_1.setLogContext)({ messageSid, stage: currentStage || "RECEIVED" });
    logger_1.log.info("Starting message processing", { currentStage });
    let stage = (currentStage || "RECEIVED");
    let mediaBlobId = message.mediaBlobId;
    let transcriptText = message.transcriptText;
    let analysis = message.analysisJson;
    try {
        if (stageIndex(stage) < stageIndex("AUDIO_STORED")) {
            (0, logger_1.setLogContext)({ stage: "AUDIO_STORED" });
            const result = await (0, audio_store_1.processAudioStore)(message);
            if (!result.success && !message.mediaUrl) {
                await (0, claim_1.releaseMessage)(messageSid, "FAILED", result.error || "Audio store failed, no fallback", "AUDIO_STORED");
                return { success: false, isHardFailure: isHardFailureError(result.error) };
            }
            mediaBlobId = result.mediaBlobId;
            stage = "AUDIO_STORED";
            await (0, claim_1.updateMessageStage)(messageSid, stage);
            logger_1.log.info("Stage AUDIO_STORED complete");
        }
        if (stageIndex(stage) < stageIndex("TRANSCRIBED")) {
            (0, logger_1.setLogContext)({ stage: "TRANSCRIBED" });
            const result = await (0, transcribe_1.processTranscribe)({ ...message, mediaBlobId }, mediaBlobId);
            if (!result.success) {
                const isHard = isHardFailureError(result.error);
                await (0, claim_1.releaseMessage)(messageSid, "RETRY", result.error || "Transcription failed", "TRANSCRIBED");
                return { success: false, isHardFailure: isHard, errorMessage: result.error };
            }
            transcriptText = result.transcriptText;
            stage = "TRANSCRIBED";
            await (0, claim_1.updateMessageStage)(messageSid, stage);
            logger_1.log.info("Stage TRANSCRIBED complete");
        }
        if (stageIndex(stage) < stageIndex("ANALYZED")) {
            (0, logger_1.setLogContext)({ stage: "ANALYZED" });
            if (!transcriptText) {
                await (0, claim_1.releaseMessage)(messageSid, "FAILED", "No transcript text for analysis", "ANALYZED");
                return { success: false, isHardFailure: false };
            }
            const result = await (0, analyze_1.processAnalyze)(message, transcriptText);
            if (!result.success || !result.analysis) {
                const isHard = isHardFailureError(result.error);
                await (0, claim_1.releaseMessage)(messageSid, "RETRY", result.error || "Analysis failed", "ANALYZED");
                return { success: false, isHardFailure: isHard, errorMessage: result.error };
            }
            analysis = result.analysis;
            stage = "ANALYZED";
            await (0, claim_1.updateMessageAnalyzed)(messageSid, analysis);
            logger_1.log.info("Stage ANALYZED complete");
        }
        if (stageIndex(stage) < stageIndex("DOC_CREATED")) {
            (0, logger_1.setLogContext)({ stage: "DOC_CREATED" });
            if (!analysis) {
                await (0, claim_1.releaseMessage)(messageSid, "FAILED", "No analysis data for doc creation", "DOC_CREATED");
                return { success: false, isHardFailure: false };
            }
            const docResult = await (0, create_doc_1.processCreateDoc)(message, analysis);
            if (!docResult.success) {
                const isHard = isHardFailureError(docResult.error);
                await (0, claim_1.releaseMessage)(messageSid, "RETRY", docResult.error || "Doc creation failed", "DOC_CREATED");
                return { success: false, isHardFailure: isHard, errorMessage: docResult.error };
            }
            stage = "DOC_CREATED";
            await (0, claim_1.updateMessageStage)(messageSid, stage);
            logger_1.log.info("Stage DOC_CREATED complete", { pendingDocId: docResult.pendingDocId });
        }
        const completed = await (0, claim_1.completeMessage)(messageSid);
        if (!completed) {
            logger_1.log.warn("Failed to complete message (ownership lost)", { messageSid });
            return { success: false, isHardFailure: false };
        }
        (0, logger_1.setLogContext)({ stage: "COMPLETED" });
        logger_1.log.info("Message processing complete");
        return { success: true, isHardFailure: false };
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const isHard = isHardFailureError(err);
        logger_1.log.error("Unexpected processing error", { error: errorMsg, stage, isHardFailure: isHard });
        await (0, claim_1.releaseMessage)(messageSid, "RETRY", `Unexpected error: ${errorMsg}`, stage);
        return { success: false, isHardFailure: isHard, errorMessage: errorMsg };
    }
}
//# sourceMappingURL=processor.js.map