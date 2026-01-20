import { WhatsappInboundMessage } from "./db";
import { updateMessageStage, updateMessageAnalyzed, releaseMessage, completeMessage } from "./claim";
import { processAudioStore } from "./stages/audio-store";
import { processTranscribe } from "./stages/transcribe";
import { processAnalyze } from "./stages/analyze";
import { processCreateDoc } from "./stages/create-doc";
import { CareDocumentationAnalysis } from "./services/openai";
import { log, setLogContext } from "./utils/logger";

type ProcessingStage =
  | "RECEIVED"
  | "AUDIO_STORED"
  | "TRANSCRIBED"
  | "ANALYZED"
  | "DOC_CREATED"
  | "NOTIF_QUEUED"
  | "COMPLETED";

const STAGE_ORDER: ProcessingStage[] = [
  "RECEIVED",
  "AUDIO_STORED",
  "TRANSCRIBED",
  "ANALYZED",
  "DOC_CREATED",
  "NOTIF_QUEUED",
  "COMPLETED",
];

function stageIndex(stage: ProcessingStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export type ProcessResult = {
  success: boolean;
  isHardFailure: boolean;
  errorMessage?: string;
};

function isHardFailureError(error: unknown): boolean {
  const errorStr = String(error).toLowerCase();
  
  if (errorStr.includes("429") || errorStr.includes("rate limit")) {
    return true;
  }
  if (/5\d\d/.test(errorStr) || errorStr.includes("internal server error")) {
    return true;
  }
  if (
    errorStr.includes("etimedout") ||
    errorStr.includes("econnreset") ||
    errorStr.includes("econnrefused") ||
    errorStr.includes("timeout")
  ) {
    return true;
  }
  return false;
}

export async function processMessage(message: WhatsappInboundMessage): Promise<ProcessResult> {
  const { messageSid, currentStage } = message;
  
  setLogContext({ messageSid, stage: currentStage || "RECEIVED" });
  log.info("Starting message processing", { currentStage });

  let stage = (currentStage || "RECEIVED") as ProcessingStage;
  let mediaBlobId = message.mediaBlobId;
  let transcriptText = message.transcriptText;
  let analysis: CareDocumentationAnalysis | null = message.analysisJson as unknown as CareDocumentationAnalysis | null;

  try {
    if (stageIndex(stage) < stageIndex("AUDIO_STORED")) {
      setLogContext({ stage: "AUDIO_STORED" });
      const result = await processAudioStore(message);
      
      if (!result.success && !message.mediaUrl) {
        await releaseMessage(messageSid, "FAILED", result.error || "Audio store failed, no fallback", "AUDIO_STORED");
        return { success: false, isHardFailure: isHardFailureError(result.error) };
      }
      
      mediaBlobId = result.mediaBlobId;
      stage = "AUDIO_STORED";
      await updateMessageStage(messageSid, stage);
      log.info("Stage AUDIO_STORED complete");
    }

    if (stageIndex(stage) < stageIndex("TRANSCRIBED")) {
      setLogContext({ stage: "TRANSCRIBED" });
      const result = await processTranscribe(
        { ...message, mediaBlobId },
        mediaBlobId
      );
      
      if (!result.success) {
        const isHard = isHardFailureError(result.error);
        await releaseMessage(messageSid, "RETRY", result.error || "Transcription failed", "TRANSCRIBED");
        return { success: false, isHardFailure: isHard, errorMessage: result.error };
      }
      
      transcriptText = result.transcriptText;
      stage = "TRANSCRIBED";
      await updateMessageStage(messageSid, stage);
      log.info("Stage TRANSCRIBED complete");
    }

    if (stageIndex(stage) < stageIndex("ANALYZED")) {
      setLogContext({ stage: "ANALYZED" });
      
      if (!transcriptText) {
        await releaseMessage(messageSid, "FAILED", "No transcript text for analysis", "ANALYZED");
        return { success: false, isHardFailure: false };
      }
      
      const result = await processAnalyze(message, transcriptText);
      
      if (!result.success || !result.analysis) {
        const isHard = isHardFailureError(result.error);
        await releaseMessage(messageSid, "RETRY", result.error || "Analysis failed", "ANALYZED");
        return { success: false, isHardFailure: isHard, errorMessage: result.error };
      }
      
      analysis = result.analysis;
      stage = "ANALYZED";
      await updateMessageAnalyzed(messageSid, analysis as unknown as Record<string, unknown>);
      log.info("Stage ANALYZED complete");
    }

    if (stageIndex(stage) < stageIndex("DOC_CREATED")) {
      setLogContext({ stage: "DOC_CREATED" });
      
      if (!analysis) {
        await releaseMessage(messageSid, "FAILED", "No analysis data for doc creation", "DOC_CREATED");
        return { success: false, isHardFailure: false };
      }
      
      const docResult = await processCreateDoc(message, analysis);
      
      if (!docResult.success) {
        const isHard = isHardFailureError(docResult.error);
        await releaseMessage(messageSid, "RETRY", docResult.error || "Doc creation failed", "DOC_CREATED");
        return { success: false, isHardFailure: isHard, errorMessage: docResult.error };
      }
      
      stage = "DOC_CREATED";
      await updateMessageStage(messageSid, stage);
      log.info("Stage DOC_CREATED complete", { pendingDocId: docResult.pendingDocId });
    }

    const completed = await completeMessage(messageSid);
    if (!completed) {
      log.warn("Failed to complete message (ownership lost)", { messageSid });
      return { success: false, isHardFailure: false };
    }
    
    setLogContext({ stage: "COMPLETED" });
    log.info("Message processing complete");
    return { success: true, isHardFailure: false };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isHard = isHardFailureError(err);
    log.error("Unexpected processing error", { error: errorMsg, stage, isHardFailure: isHard });
    await releaseMessage(messageSid, "RETRY", `Unexpected error: ${errorMsg}`, stage);
    return { success: false, isHardFailure: isHard, errorMessage: errorMsg };
  }
}
