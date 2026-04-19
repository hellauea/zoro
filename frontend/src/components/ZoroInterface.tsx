import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { MicButton } from "./MicButton";
import { TranscriptDisplay } from "./TranscriptDisplay";

const BACKEND_URL = "http://127.0.0.1:5000/command";

export function ZoroInterface() {
  const {
    isListening,
    transcript,
    error: speechError,
    isSupported,
    startListening,
    stopListening,
  } = useSpeechRecognition();

  const [isProcessing, setIsProcessing] = useState(false);
  const [zoroResponse, setZoroResponse] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [backendError, setBackendError] = useState<string | null>(null);

  const sendCommand = useCallback(async (text: string) => {
    if (!text.trim()) return;

    setIsProcessing(true);
    setBackendError(null);

    try {
      const res = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      // ✅ THIS WAS THE ISSUE
      if (!data.response) {
        throw new Error("Invalid response from backend");
      }

      setZoroResponse(data.response);
    } catch (err: any) {
      console.error("Backend fetch error:", err);
      setBackendError("ZORO backend not responding");
      setZoroResponse("");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  useEffect(() => {
    if (!isListening && transcript && transcript !== lastTranscript) {
      setLastTranscript(transcript);
      sendCommand(transcript);
    }
  }, [isListening, transcript, lastTranscript, sendCommand]);

  const handleMicClick = () => {
    if (isListening) {
      stopListening();
    } else {
      setZoroResponse("");
      setBackendError(null);
      startListening();
    }
  };

  if (!isSupported) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500">
        Speech recognition not supported in this browser
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background cyber-grid flex flex-col items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <h1 className="text-5xl font-bold text-primary neon-text">ZORO</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Your Local Assistant
        </p>
      </motion.div>

      <MicButton
        isListening={isListening}
        isProcessing={isProcessing}
        onClick={handleMicClick}
      />

      <div className="mt-10 w-full flex justify-center">
        <TranscriptDisplay
          userTranscript={lastTranscript}
          zoroResponse={zoroResponse}
          error={backendError ?? speechError}
        />
      </div>
    </div>
  );
}
