"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOpenAIClient = getOpenAIClient;
exports.transcribeAudio = transcribeAudio;
exports.analyzeTranscript = analyzeTranscript;
const openai_1 = __importStar(require("openai"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
let openaiClient = null;
function getOpenAIClient() {
    if (!openaiClient) {
        openaiClient = new openai_1.default({ apiKey: config_1.config.openai.apiKey });
    }
    return openaiClient;
}
async function transcribeAudio(audioBuffer, language = "en") {
    const client = getOpenAIClient();
    logger_1.log.info("Sending audio to OpenAI Whisper", { size: audioBuffer.length, language });
    const audioFile = await (0, openai_1.toFile)(audioBuffer, "voice_message.ogg", { type: "audio/ogg" });
    const transcription = await client.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        language,
        response_format: "text",
    });
    logger_1.log.info("Transcription complete", { length: transcription.length });
    return transcription;
}
async function analyzeTranscript(transcriptText, agencyId) {
    const client = getOpenAIClient();
    const systemPrompt = `You are a healthcare documentation assistant that extracts structured care information from nurse voice messages. 
Extract:
- Patient identification (name or ID)
- Date of service
- Care activities performed (use KH codes if applicable)
- Any alerts or concerns
- Detect the original language

Respond in JSON format with keys: patientId, patientName, serviceDate, khCodes, structuredData, alerts, originalLanguage`;
    const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: transcriptText },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
        logger_1.log.warn("No content in GPT response");
        return null;
    }
    try {
        const parsed = JSON.parse(content);
        return {
            patientId: parsed.patientId || "",
            patientName: parsed.patientName || "",
            serviceDate: parsed.serviceDate || new Date().toISOString().split("T")[0],
            rawContent: transcriptText,
            khCodes: parsed.khCodes || [],
            structuredData: parsed.structuredData || {},
            alerts: parsed.alerts || [],
            originalLanguage: parsed.originalLanguage || "de",
            translations: {},
        };
    }
    catch (err) {
        logger_1.log.error("Failed to parse GPT response", { error: String(err), content });
        return null;
    }
}
//# sourceMappingURL=openai.js.map