import { WhatsappInboundMessage } from "../db";
import { analyzeTranscript, CareDocumentationAnalysis } from "../services/openai";
import { log } from "../utils/logger";

export interface AnalyzeResult {
  success: boolean;
  analysis: CareDocumentationAnalysis | null;
  error?: string;
}

export async function processAnalyze(
  message: WhatsappInboundMessage,
  transcriptText: string
): Promise<AnalyzeResult> {
  const { messageSid, agencyId, analysisJson } = message;

  if (analysisJson && Object.keys(analysisJson).length > 0) {
    log.info("Analysis already exists, skipping", { messageSid });
    return { success: true, analysis: analysisJson as unknown as CareDocumentationAnalysis };
  }

  if (!transcriptText) {
    return { success: false, analysis: null, error: "No transcript text available" };
  }

  try {
    const analysis = await analyzeTranscript(transcriptText, agencyId);

    if (!analysis) {
      return { success: false, analysis: null, error: "Analysis returned null" };
    }

    log.info("Analyze stage complete", {
      messageSid,
      patientName: analysis.patientName,
      khCodes: analysis.khCodes.length,
    });

    return { success: true, analysis };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("Analyze stage failed", { messageSid, error: errorMsg });
    return { success: false, analysis: null, error: errorMsg };
  }
}
