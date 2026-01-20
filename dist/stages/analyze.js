"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processAnalyze = processAnalyze;
const openai_1 = require("../services/openai");
const logger_1 = require("../utils/logger");
async function processAnalyze(message, transcriptText) {
    const { messageSid, agencyId, analysisJson } = message;
    if (analysisJson && Object.keys(analysisJson).length > 0) {
        logger_1.log.info("Analysis already exists, skipping", { messageSid });
        return { success: true, analysis: analysisJson };
    }
    if (!transcriptText) {
        return { success: false, analysis: null, error: "No transcript text available" };
    }
    try {
        const analysis = await (0, openai_1.analyzeTranscript)(transcriptText, agencyId);
        if (!analysis) {
            return { success: false, analysis: null, error: "Analysis returned null" };
        }
        logger_1.log.info("Analyze stage complete", {
            messageSid,
            patientName: analysis.patientName,
            khCodes: analysis.khCodes.length,
        });
        return { success: true, analysis };
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger_1.log.error("Analyze stage failed", { messageSid, error: errorMsg });
        return { success: false, analysis: null, error: errorMsg };
    }
}
//# sourceMappingURL=analyze.js.map