import { motion, AnimatePresence } from 'framer-motion';

interface TranscriptDisplayProps {
  userTranscript: string;
  zoroResponse: string;
  error: string | null;
}

export function TranscriptDisplay({ userTranscript, zoroResponse, error }: TranscriptDisplayProps) {
  return (
    <div className="w-full max-w-md space-y-4">
      {/* User transcript */}
      <AnimatePresence mode="wait">
        {(userTranscript || error) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass p-4"
          >
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">You said</p>
            <p className={`text-lg ${error ? 'text-destructive' : 'text-foreground'}`}>
              {error || `"${userTranscript}"`}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ZORO response */}
      <AnimatePresence mode="wait">
        {zoroResponse && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass p-4 border-primary/30"
          >
            <p className="text-xs text-primary mb-1 uppercase tracking-wider font-medium">ZORO</p>
            <p className="text-lg text-foreground">{zoroResponse}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backend error */}
      <AnimatePresence mode="wait">
        {zoroResponse === '__BACKEND_ERROR__' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass p-4 border-destructive/30"
          >
            <p className="text-destructive text-center">
              ⚠️ ZORO backend not running
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
