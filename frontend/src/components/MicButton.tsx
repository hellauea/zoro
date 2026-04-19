import { motion } from 'framer-motion';
import { Mic, Loader2 } from 'lucide-react';

interface MicButtonProps {
  isListening: boolean;
  isProcessing: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function MicButton({ isListening, isProcessing, onClick, disabled }: MicButtonProps) {
  return (
    <div className="relative">
      {/* Animated pulse rings when listening */}
      {isListening && (
        <>
          <motion.div
            className="absolute inset-0 rounded-full bg-primary/30"
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 2.5, opacity: 0 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div
            className="absolute inset-0 rounded-full bg-primary/20"
            initial={{ scale: 1, opacity: 0.4 }}
            animate={{ scale: 3, opacity: 0 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut", delay: 0.3 }}
          />
          <motion.div
            className="absolute inset-0 rounded-full bg-primary/10"
            initial={{ scale: 1, opacity: 0.3 }}
            animate={{ scale: 3.5, opacity: 0 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut", delay: 0.6 }}
          />
        </>
      )}

      {/* Main button */}
      <motion.button
        onClick={onClick}
        disabled={disabled || isProcessing}
        className={`
          relative z-10 w-28 h-28 rounded-full 
          flex items-center justify-center
          transition-all duration-300
          border-2
          ${isListening 
            ? 'bg-primary/20 border-primary neon-box-intense' 
            : 'bg-secondary/80 border-glass-border neon-box hover:border-primary/50'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        whileHover={!disabled && !isProcessing ? { scale: 1.05 } : {}}
        whileTap={!disabled && !isProcessing ? { scale: 0.95 } : {}}
        animate={isListening ? { 
          boxShadow: [
            '0 0 20px hsl(180 100% 50% / 0.6), 0 0 40px hsl(180 100% 50% / 0.4)',
            '0 0 30px hsl(180 100% 50% / 0.8), 0 0 60px hsl(180 100% 50% / 0.5)',
            '0 0 20px hsl(180 100% 50% / 0.6), 0 0 40px hsl(180 100% 50% / 0.4)',
          ]
        } : {}}
        transition={{ duration: 1, repeat: isListening ? Infinity : 0 }}
      >
        {isProcessing ? (
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        ) : (
          <motion.div
            animate={isListening ? { scale: [1, 1.1, 1] } : {}}
            transition={{ duration: 0.5, repeat: isListening ? Infinity : 0 }}
          >
            <Mic 
              className={`w-10 h-10 transition-colors duration-300 ${
                isListening ? 'text-primary' : 'text-muted-foreground'
              }`} 
            />
          </motion.div>
        )}
      </motion.button>

      {/* Status text */}
      <motion.p
        className="text-center mt-4 text-sm text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        key={isListening ? 'listening' : isProcessing ? 'processing' : 'idle'}
      >
        {isProcessing ? 'Processing...' : isListening ? 'Listening...' : 'Tap to speak'}
      </motion.p>
    </div>
  );
}
