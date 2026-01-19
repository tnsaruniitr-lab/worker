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

export async function processMessage(message: WhatsappInboundMessage): Promise<boolean> {
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
        await releaseMessage(messageSid, "FAILED", result.error || "Audio store failed, no fallback");
        return false;
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
        await releaseMessage(messageSid, "RETRY", result.error || "Transcription failed");
        return false;
      }
      
      transcriptText = result.transcriptText;
      stage = "TRANSCRIBED";
      await updateMessageStage(messageSid, stage);
      log.info("Stage TRANSCRIBED complete");
    }

    if (stageIndex(stage) < stageIndex("ANALYZED")) {
      setLogContext({ stage: "ANALYZED" });
      
      if (!transcriptText) {
        await releaseMessage(messageSid, "FAILED", "No transcript text for analysis");
        return false;
      }
      
      const result = await processAnalyze(message, transcriptText);
      
      if (!result.success || !result.analysis) {
        await releaseMessage(messageSid, "RETRY", result.error || "Analysis failed");
        return false;
      }
      
      analysis = result.analysis;
      stage = "ANALYZED";
      await updateMessageAnalyzed(messageSid, analysis as unknown as Record<string, unknown>);
      log.info("Stage ANALYZED complete");
    }

    if (stageIndex(stage) < stageIndex("DOC_CREATED")) {
      setLogContext({ stage: "DOC_CREATED" });
      
      if (!analysis) {
        await releaseMessage(messageSid, "FAILED", "No analysis data for doc creation");
        return false;
      }
      
      const docResult = await processCreateDoc(message, analysis);
      
      if (!docResult.success) {
        await releaseMessage(messageSid, "RETRY", docResult.error || "Doc creation failed");
        return false;
      }
      
      stage = "DOC_CREATED";
      await updateMessageStage(messageSid, stage);
      log.info("Stage DOC_CREATED complete", { pendingDocId: docResult.pendingDocId });
    }

    await completeMessage(messageSid);
    setLogContext({ stage: "COMPLETED" });
    log.info("Message processing complete");
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("Unexpected processing error", { error: errorMsg, stage });
    await releaseMessage(messageSid, "RETRY", `Unexpected error: ${errorMsg}`);
    return false;
  }
}
