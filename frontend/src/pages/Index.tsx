import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import {
  saveChat as fsaveChat,
  loadChats as floadChats,
  deleteChat as fdeleteChat,
  saveMemory as fsaveMemory,
  loadMemory as floadMemory,
  saveUserSettings,
  loadUserSettings,
  DEFAULT_SETTINGS,
  uploadDocument,
} from "@/lib/firestore";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = "user" | "zoro";
type Mode = "chat" | "voice";

type Message = {
  id: string;
  role: Role;
  text: string;
  image?: string;
  document?: { name: string; url: string };
  timestamp: Date;
  pinned?: boolean;
};

type Chat = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
};

type Settings = {
  ttsEnabled: boolean;
  soundEnabled: boolean;
  storeHistory: boolean;
  darkMode: boolean;
};

type SuggestionItem = { icon: string; label: string; prompt: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_URL as string;

const SUGGESTIONS: SuggestionItem[] = [
  { icon: "🖼️", label: "Create an image", prompt: "Create a detailed, vibrant image of " },
  { icon: "✍️", label: "Write for me", prompt: "Write a compelling " },
  { icon: "💡", label: "Brainstorm ideas", prompt: "Give me 10 creative ideas for " },
  { icon: "🔍", label: "Research a topic", prompt: "Give me a comprehensive breakdown of " },
  { icon: "📖", label: "Explain something", prompt: "Explain in simple terms: " },
  { icon: "🎯", label: "Help me plan", prompt: "Help me create a detailed plan for " },
];

// ─── Audio ────────────────────────────────────────────────────────────────────

let activeAudio: HTMLAudioElement | null = null;

function stopSpeaking() { if (activeAudio) { activeAudio.pause(); activeAudio = null; } }

function playDone() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const note = (f: number, d: number, dur: number, v: number) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); const t = ctx.currentTime + d;
      o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
    };
    note(523, 0, 0.4, 0.07); note(659, 0.12, 0.35, 0.06);
  } catch { }
}

async function speakText(text: string, onEnd?: () => void) {
  stopSpeaking();
  const clean = text.replace(/```[\s\S]*?```/g, "code").replace(/[*_#`]/g, "").replace(/\n+/g, ". ").trim();
  if (!clean) return;
  try {
    const res = await fetch(`${API}/tts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean }),
    });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url); activeAudio = audio;
    audio.onended = () => { activeAudio = null; URL.revokeObjectURL(url); onEnd?.(); };
    audio.onerror = () => { activeAudio = null; URL.revokeObjectURL(url); onEnd?.(); };
    await audio.play();
  } catch { onEnd?.(); }
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

function renderMd(text: string) {
  return text.replace(/\[System:[^\]]*\]/g, "").trim()
    .replace(/https:\/\/image\.pollinations\.ai\/prompt\/[^\s)]+/g, "")
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_: string, __: string, c: string) => `<pre class="z-code"><code>${c.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code></pre>`)
    .replace(/`([^`]+)`/g, "<code class='z-ic'>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^[*-] (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId() { return crypto.randomUUID(); }
function isMob() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || "ontouchstart" in window; }
function chatTitle(msgs: Message[]) {
  const f = msgs.find(m => m.role === "user");
  if (!f) return "New chat";
  const t = f.text || "image";
  return t.length > 38 ? t.slice(0, 38) + "…" : t;
}
function groupByDate(chats: Chat[]) {
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest = new Date(today.getTime() - 864e5); const week = new Date(today.getTime() - 6 * 864e5);
  const g: Record<string, Chat[]> = { Today: [], Yesterday: [], "This week": [], Older: [] };
  for (const c of chats) {
    const d = new Date(c.createdAt.getFullYear(), c.createdAt.getMonth(), c.createdAt.getDate());
    if (d >= today) g["Today"].push(c);
    else if (d >= yest) g["Yesterday"].push(c);
    else if (d >= week) g["This week"].push(c);
    else g["Older"].push(c);
  }
  return Object.entries(g).filter(([, v]) => v.length).map(([label, items]) => ({ label, items }));
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const Ico = {
  send: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2L15 22 11 13 2 9l20-7z" /></svg>,
  mic: (f = false) => <svg width="16" height="16" viewBox="0 0 24 24" fill={f ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>,
  img: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>,
  x: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  refresh: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21v-5h5" /></svg>,
  menu: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>,
  plus: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>,
  copy: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
  check: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  pin: (f = false) => <svg width="13" height="13" viewBox="0 0 24 24" fill={f ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>,
  brain: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.96-3 2.5 2.5 0 0 1-1.32-4.24 3 3 0 0 1 .34-5.58 2.5 2.5 0 0 1 1.96-3A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.96-3 2.5 2.5 0 0 0 1.32-4.24 3 3 0 0 0-.34-5.58 2.5 2.5 0 0 0-1.96-3A2.5 2.5 0 0 0 14.5 2Z" /></svg>,
  settings: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  speaker: (on = false) => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />{on ? <><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></> : <line x1="23" y1="9" x2="17" y2="15" />}</svg>,
  chat: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  clip: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>,
  camera: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>,
  download: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  external: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>,
  sparkle: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z" /></svg>,
};

// ─── Message Bubble ───────────────────────────────────────────────────────────

function Bubble({ msg, onPin, onSpeak, onRegenerate, speaking, tts, isLastZoro }: {
  msg: Message; onPin: (id: string) => void;
  onSpeak: (text: string, id: string) => void;
  onRegenerate: (id: string) => void;
  speaking: boolean; tts: boolean; isLastZoro: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [imgCopied, setImgCopied] = useState(false);
  const isZ = msg.role === "zoro";
  const time = msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const copy = () => {
    navigator.clipboard.writeText(msg.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url).then(() => { setImgCopied(true); setTimeout(() => setImgCopied(false), 1800); });
  };

  const dlImg = async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `zoro-${Date.now()}.jpg`;
      link.click();
    } catch (e) { console.error("Download failed", e); }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.24, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={`bubble-row ${isZ ? "z-row" : "u-row"}${msg.pinned ? " pinned" : ""}`}
    >
      <div className={`avatar ${isZ ? "z-av" : "u-av"}`}>
        {isZ ? "Z" : "U"}
      </div>
      <div className={`bwrap ${isZ ? "z-wrap" : "u-wrap"}`}>
        {msg.pinned && <span className="pin-tag">📌 pinned</span>}
        <div className={`bubble ${isZ ? "z-bubble" : "u-bubble"}`}>
          {msg.image && (
            <div className="bubble-img-container">
              <img src={msg.image} alt="" className="b-img" />
              <div className="img-overlay">
                <button className="img-btn" onClick={() => dlImg(msg.image!)} title="Download">{Ico.download}</button>
                <button className="img-btn" onClick={() => copyLink(msg.image!)} title="Copy Link">{imgCopied ? Ico.check : Ico.external}</button>
              </div>
            </div>
          )}
          {msg.document && (
            <a href={msg.document.url} target="_blank" rel="noopener noreferrer" className="b-doc-card">
              <span className="b-doc-ico">{Ico.clip}</span>
              <span className="b-doc-name">{msg.document.name}</span>
            </a>
          )}
          {isZ
            ? msg.text === ""
              ? <div className="typing"><span /><span /><span /></div>
              : <div dangerouslySetInnerHTML={{ __html: renderMd(msg.text) }} />
            : <span>{msg.text}</span>}
        </div>
        <div className="bmeta">
          <span className="btime">{time}</span>
          <button className="bact" onClick={copy} title="Copy">{copied ? Ico.check : Ico.copy}</button>
          <button className="bact" onClick={() => onPin(msg.id)} title="Pin">{Ico.pin(!!msg.pinned)}</button>
          {isZ && isLastZoro && (
            <button className="bact" onClick={() => onRegenerate(msg.id)} title="Regenerate">{Ico.refresh}</button>
          )}
          {isZ && tts && msg.text && (
            <button className={`bact ${speaking ? "bact-on" : ""}`} onClick={() => onSpeak(msg.text, msg.id)}>
              {Ico.speaker(speaking)}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Voice Mode ───────────────────────────────────────────────────────────────

function VoiceMode({ memory, settings }: { memory: string[]; settings: Settings }) {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [err, setErr] = useState("");
  const [speakId, setSpeakId] = useState<string | null>(null);
  const recRef = useRef<any>(null);

  const send = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setProcessing(true); setErr(""); setResponse("");
    try {
      const res = await fetch(`${API}/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, history: [], memory }),
      });
      const reader = res.body!.getReader(); const dec = new TextDecoder();
      let buf = "", full = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const p = JSON.parse(line.slice(6));
            if (p.token) { full += p.token; setResponse(full.replace(/\[System:[^\]]*\]/g, "").trim()); }
            if (p.done && settings.soundEnabled) playDone();
          } catch { }
        }
      }
      if (settings.ttsEnabled && full) {
        const id = makeId(); setSpeakId(id);
        speakText(full, () => setSpeakId(null));
      }
    } catch { setErr("Can't reach ZORO — is the backend running?"); }
    setProcessing(false);
  }, [memory, settings]);

  const startListen = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setErr("Voice not supported in this browser. Try Chrome."); return; }
    setTranscript(""); setResponse(""); setErr(""); stopSpeaking(); setSpeakId(null);
    const r = new SR(); r.continuous = false; r.interimResults = true; r.lang = "en-IN";
    r.onstart = () => setListening(true);
    r.onresult = (e: any) => setTranscript(Array.from(e.results).map((x: any) => x[0].transcript).join(""));
    r.onend = () => { setListening(false); setTimeout(() => { setTranscript(t => { if (t.trim()) send(t); return t; }); }, 200); };
    r.onerror = () => setListening(false);
    recRef.current = r; r.start();
  };

  const stopListen = () => { recRef.current?.stop(); setListening(false); };

  return (
    <div className="voice-shell">
      <div className="orb-area">
        {listening && [0, 1, 2].map(i => (
          <motion.div key={i} className="orb-ring"
            initial={{ scale: 1, opacity: 0.4 - i * 0.1 }}
            animate={{ scale: 2.2 + i * 0.5, opacity: 0 }}
            transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.35, ease: "easeOut" }}
          />
        ))}
        <motion.button
          className={`orb${listening ? " orb-live" : ""}${processing ? " orb-wait" : ""}`}
          onClick={listening ? stopListen : startListen}
          disabled={processing}
          whileHover={!processing ? { scale: 1.06 } : {}}
          whileTap={!processing ? { scale: 0.93 } : {}}
        >
          {processing
            ? <motion.div className="orb-spin" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
            : Ico.mic(listening)
          }
        </motion.button>
      </div>

      <motion.p className="orb-label"
        key={listening ? "l" : processing ? "p" : "i"}
        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
        {processing ? "thinking…" : listening ? "listening…" : "tap to speak"}
      </motion.p>

      <div className="voice-cards">
        <AnimatePresence mode="wait">
          {(transcript || err) && (
            <motion.div className={`vcard you-card${err ? " err-card" : ""}`}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <span className="vc-who">you</span>
              <p className="vc-text">{err || `"${transcript}"`}</p>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence mode="wait">
          {response && (
            <motion.div className="vcard z-vcard"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="vc-head">
                <span className="vc-who zvc-who">zoro</span>
                {settings.ttsEnabled && (
                  <button className={`bact ${speakId ? "bact-on" : ""}`}
                    onClick={() => speakId ? (stopSpeaking(), setSpeakId(null)) : speakText(response, () => setSpeakId(null)) || setSpeakId("1")}>
                    {Ico.speaker(!!speakId)}
                  </button>
                )}
              </div>
              <p className="vc-text">{response}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ chats, activeChatId, onLoad, onDelete, onNew, onClose, user }: {
  chats: Chat[]; activeChatId: string | null;
  onLoad: (c: Chat) => void; onDelete: (id: string) => void;
  onNew: () => void; onClose: () => void; user: any;
}) {
  const grouped = groupByDate(chats);
  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const initial = displayName[0].toUpperCase();

  return (
    <div className="sb">
      <div className="sb-top">
        <div className="sb-brand">
          <div className="sb-dot" />
          <span>ZORO</span>
        </div>
        <button className="ib" onClick={onClose}>{Ico.x(13)}</button>
      </div>
      <button className="sb-new" onClick={onNew}>
        <span className="sb-new-ico">{Ico.plus}</span>
        <span>New chat</span>
      </button>
      <div className="sb-list">
        {chats.length === 0
          ? (
            <div className="sb-empty-state">
              <div className="sb-empty-icon">💬</div>
              <p className="sb-empty">No chats yet.</p>
              <p className="sb-empty-sub">Start a conversation to see it here.</p>
            </div>
          )
          : grouped.map(({ label, items }) => (
            <div key={label}>
              <p className="sb-gl">{label}</p>
              {items.map(chat => (
                <div key={chat.id} className={`sb-item${chat.id === activeChatId ? " sb-active" : ""}`}
                  onClick={() => onLoad(chat)}>
                  <div className="sb-i-ico">{Ico.chat}</div>
                  <span className="sb-i-title">{chat.title}</span>
                  <button className="sb-del" onClick={e => { e.stopPropagation(); onDelete(chat.id); }}>
                    {Ico.trash}
                  </button>
                </div>
              ))}
            </div>
          ))}
      </div>
      {/* User info at bottom of sidebar */}
      {user && (
        <div className="sb-user">
          <div className="sb-user-av">
            {user.photoURL
              ? <img src={user.photoURL} alt="" className="sb-user-av-img" referrerPolicy="no-referrer" />
              : <span>{initial}</span>}
          </div>
          <div className="sb-user-info">
            <span className="sb-user-name">{displayName}</span>
            {user.email && <span className="sb-user-email">{user.email}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Memory Panel ─────────────────────────────────────────────────────────────

function MemPanel({ memory, onAdd, onDel, onClose }: {
  memory: string[]; onAdd: (s: string) => void; onDel: (i: number) => void; onClose: () => void;
}) {
  const [val, setVal] = useState("");
  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="panel-title">{Ico.brain} Memory</span>
        <button className="ib" onClick={onClose}>{Ico.x(12)}</button>
      </div>
      <p className="panel-hint">Things ZORO always remembers about you.</p>
      <div className="mem-list">
        {memory.length === 0 && <p className="mem-empty">Nothing saved yet.</p>}
        {memory.map((item, i) => (
          <div key={i} className="mem-item">
            <span className="mem-text">{item}</span>
            <button className="mem-del" onClick={() => onDel(i)}>{Ico.x(10)}</button>
          </div>
        ))}
      </div>
      <div className="panel-inp-row">
        <input className="panel-inp" value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === "Enter" && val.trim() && (onAdd(val.trim()), setVal(""))}
          placeholder="e.g. my name is Arjun" />
        <button className="panel-add" onClick={() => val.trim() && (onAdd(val.trim()), setVal(""))}>Add</button>
      </div>
    </div>
  );
}

// ─── Profile Dropdown ─────────────────────────────────────────────────────────

function ProfileDropdown({ user, settings, onChange, onOpenMemory, onClose, onSignOut, isTempChat, onToggleTemp, onNewChat }: {
  user: any; settings: Settings; onChange: (s: Settings) => void;
  onOpenMemory: () => void; onClose: () => void; onSignOut: () => void;
  isTempChat: boolean; onToggleTemp: () => void; onNewChat: () => void;
}) {
  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const initial = displayName[0].toUpperCase();

  return (
    <div className="prof-drop">
      <div className="prof-user">
        <div className="prof-av">
          {user?.photoURL
            ? <img src={user.photoURL} alt="" className="prof-av-img" referrerPolicy="no-referrer" />
            : <span>{initial}</span>}
        </div>
        <div className="prof-info">
          <span className="prof-name">{displayName}</span>
          {email && <span className="prof-email">{email}</span>}
        </div>
        <button className="ib" onClick={onClose}>{Ico.x(12)}</button>
      </div>

      <div className="prof-divider" />

      <div className="prof-section-label">Actions</div>
      <button className="prof-action" onClick={() => { onNewChat(); onClose(); }}>
        <span className="prof-action-ico">{Ico.plus}</span>
        <div className="prof-action-info">
          <span className="prof-action-label">New chat</span>
          <span className="prof-action-desc">Start a fresh conversation</span>
        </div>
        <span className="prof-action-arr">›</span>
      </button>
      <button className="prof-action" onClick={() => { onOpenMemory(); onClose(); }}>
        <span className="prof-action-ico">{Ico.brain}</span>
        <div className="prof-action-info">
          <span className="prof-action-label">Memory</span>
          <span className="prof-action-desc">Things ZORO remembers about you</span>
        </div>
        <span className="prof-action-arr">›</span>
      </button>

      <div className="prof-divider" />

      <label className="set-row temp-row">
        <div className="set-info">
          <span className="set-label"><span className="set-icon">🕵️</span>Temporary chat</span>
          <span className="set-desc">No history or memory saved</span>
        </div>
        <div className={`tog${isTempChat ? " tog-on" : ""}`} onClick={onToggleTemp}>
          <div className="tog-thumb" />
        </div>
      </label>

      <div className="prof-divider" />

      <div className="set-signout-wrap">
        <button className="set-signout" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

function SettingsDropdown({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void; }) {
  const settingRows: { key: keyof Settings; label: string; desc: string; icon: string }[] = [
    { key: "soundEnabled", label: "Completion chime", desc: "Soft sound when ZORO finishes", icon: "🔔" },
    { key: "ttsEnabled", label: "Voice replies", desc: "Read responses aloud via ElevenLabs", icon: "🎙️" },
    { key: "storeHistory", label: "Save history", desc: "Sync chats to the cloud", icon: "☁️" },
    { key: "darkMode", label: "Dark mode", desc: "Switch to dark theme", icon: "🌙" },
  ];
  return (
    <div className="prof-drop">
      <div className="prof-user">
        <div className="prof-info"><span className="prof-name">Settings</span></div>
        <button className="ib" onClick={onClose}>{Ico.x(12)}</button>
      </div>
      <div className="prof-divider" />
      <div className="set-list">
        {settingRows.map(({ key, label, desc, icon }) => (
          <label key={key} className="set-row">
            <div className="set-info">
              <span className="set-label"><span className="set-icon">{icon}</span>{label}</span>
              <span className="set-desc">{desc}</span>
            </div>
            <div className={`tog${settings[key] ? " tog-on" : ""}`} onClick={() => onChange({ ...settings, [key]: !settings[key] })}>
              <div className="tog-thumb" />
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Index() {
  const { user, signOut } = useAuth();
  const uid = user?.uid || "";

  // ── Derive first name for greeting ──
  const firstName = user?.displayName?.split(" ")[0] || user?.email?.split("@")[0] || "there";

  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [pendingImg, setPendingImg] = useState<string | null>(null);
  const [pendingDoc, setPendingDoc] = useState<{ name: string, file: File } | null>(null);
  const [memory, setMemory] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showMem, setShowMem] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isTempChat, setIsTempChat] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [mobile] = useState(isMob);

  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<any>(null);
  const sbRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { const ta = taRef.current; if (!ta) return; ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 150) + "px"; }, [input]);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const [c, m, s] = await Promise.all([floadChats(uid), floadMemory(uid), loadUserSettings(uid)]);
      if (cancelled) return;
      setChats(c); setMemory(m); setSettings(s); setDataLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [uid]);

  useEffect(() => { document.documentElement.classList.toggle("dark", settings.darkMode); }, [settings.darkMode]);

  useEffect(() => {
    if (!uid || !dataLoaded) return;
    const t = setTimeout(() => fsaveMemory(uid, memory), 600);
    return () => clearTimeout(t);
  }, [memory, uid, dataLoaded]);

  useEffect(() => {
    if (!uid || !dataLoaded) return;
    const t = setTimeout(() => saveUserSettings(uid, settings), 600);
    return () => clearTimeout(t);
  }, [settings, uid, dataLoaded]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (sidebarOpen && sbRef.current && !sbRef.current.contains(e.target as Node)) setSidebarOpen(false);
      const t = e.target as HTMLElement;
      if (!t.closest('.prof-panel-wrap') && !t.closest('.hdr-r')) {
        setShowProfile(false);
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!uid || !dataLoaded || !messages.length || !settings.storeHistory || isTempChat) return;
    setChats(prev => {
      if (activeChatId) {
        const updated = prev.map(c => c.id === activeChatId ? { ...c, messages, title: chatTitle(messages) } : c);
        const chat = updated.find(c => c.id === activeChatId);
        if (chat) fsaveChat(uid, chat);
        return updated;
      }
      const nc: Chat = { id: makeId(), title: chatTitle(messages), messages, createdAt: new Date() };
      setActiveChatId(nc.id);
      fsaveChat(uid, nc);
      return [nc, ...prev];
    });
  }, [messages, settings.storeHistory, isTempChat]);

  useEffect(() => {
    const fn = (e: ClipboardEvent) => {
      for (const item of e.clipboardData?.items || []) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile(); if (!f) continue;
          const r = new FileReader(); r.onload = () => setPendingImg(r.result as string); r.readAsDataURL(f); break;
        }
      }
    };
    window.addEventListener("paste", fn); return () => window.removeEventListener("paste", fn);
  }, []);

  const newChat = () => {
    setMessages([]); setInput(""); setActiveChatId(null); setPendingImg(null); setPendingDoc(null);
    setSidebarOpen(false); stopSpeaking(); setSpeakingId(null);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const loadChat = (c: Chat) => {
    setMessages(c.messages); setActiveChatId(c.id); setSidebarOpen(false);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const delChat = (id: string) => {
    setChats(prev => prev.filter(c => c.id !== id));
    if (uid) fdeleteChat(uid, id);
    if (activeChatId === id) { setMessages([]); setActiveChatId(null); }
  };

  const startListen = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Voice not supported. Try Chrome."); return; }
    const r = new SR(); r.continuous = false; r.interimResults = true; r.lang = "en-IN";
    r.onstart = () => setIsListening(true);
    r.onresult = (e: any) => setInput(Array.from(e.results).map((x: any) => x[0].transcript).join(""));
    r.onend = () => { setIsListening(false); setTimeout(() => { setInput(cur => { if (cur.trim()) { send(cur.trim()); return ""; } return cur; }); }, 200); };
    r.onerror = () => setIsListening(false);
    recRef.current = r; r.start();
  }, []);

  const stopListen = useCallback(() => { recRef.current?.stop(); setIsListening(false); }, []);

  const handleSpeak = (text: string, id: string) => {
    if (speakingId === id) { stopSpeaking(); setSpeakingId(null); return; }
    setSpeakingId(id); speakText(text, () => setSpeakingId(null));
  };

  const handleRegenerate = async (id: string) => {
    const idx = messages.findIndex(m => m.id === id);
    if (idx === -1) return;
    const prevMsgs = messages.slice(0, idx);
    setMessages(prevMsgs);
    const lastUserMsg = [...prevMsgs].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      setLoading(true);
      const history = prevMsgs.slice(-20).map(m => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
      const activeMemory = isTempChat ? [] : memory;
      const sid = makeId();
      setMessages(p => [...p, { id: sid, role: "zoro", text: "", timestamp: new Date() }]);
      try {
        let res;
        if (lastUserMsg.image) {
          res = await fetch(`${API}/vision`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: lastUserMsg.text || "describe what you see in this image", image_base64: lastUserMsg.image.includes(",") ? lastUserMsg.image.split(",")[1] : lastUserMsg.image, image_mime: "image/jpeg", history, memory: activeMemory }),
          });
        } else {
          res = await fetch(`${API}/stream`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: lastUserMsg.text, history, memory: activeMemory }),
          });
        }
        if (!res.ok) throw new Error();
        const reader = res.body!.getReader(); const dec = new TextDecoder();
        let buf = "", full = "";
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const p = JSON.parse(line.slice(6));
              if (p.token) { full += p.token; const c = full.replace(/\[System:[^\]]*\]/g, "").trim(); setMessages(msgs => msgs.map(m => m.id === sid ? { ...m, text: c } : m)); }
              if (p.image) { setMessages(msgs => msgs.map(m => m.id === sid ? { ...m, image: p.image } : m)); }
              if (p.done) {
                if (settings.soundEnabled) playDone();
                if (settings.ttsEnabled) { setSpeakingId(sid); speakText(full, () => setSpeakingId(null)); }
                if (!isTempChat && p.new_memory?.length > 0) { setMemory(prev => { const merged = [...prev]; for (const item of p.new_memory) { if (item && !merged.includes(item)) merged.push(item); } return merged; }); }
              }
            } catch { }
          }
        }
      } catch (e) {
        setMessages(p => [...p, { id: makeId(), role: "zoro", text: "can't reach the backend — make sure it's running.", timestamp: new Date() }]);
      }
      setLoading(false);
    }
  };

  const send = async (override?: string) => {
    const txt = (override ?? input).trim();
    if ((!txt && !pendingImg && !pendingDoc) || loading) return;
    setLoading(true); stopSpeaking(); setSpeakingId(null);
    const doc = pendingDoc; const img = pendingImg;
    setInput(""); setPendingImg(null); setPendingDoc(null);
    let docUrl = "";
    if (doc && uid) { try { docUrl = await uploadDocument(uid, doc.file); } catch (e) { console.error("Upload failed:", e); } }
    const userMsg: Message = { id: makeId(), role: "user", text: txt || (doc ? doc.name : ""), image: img ?? undefined, document: docUrl ? { name: doc!.name, url: docUrl } : undefined, timestamp: new Date() };
    const next = [...messages, userMsg];
    setMessages(next);
    const history = next.slice(-20).map(m => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
    const activeMemory = isTempChat ? [] : memory;
    const sid = makeId();
    setMessages(p => [...p, { id: sid, role: "zoro", text: "", timestamp: new Date() }]);
    try {
      let res: Response;
      if (img) {
        const b64 = await compressImage(img);
        res = await fetch(`${API}/vision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: txt || "describe what you see in this image", image_base64: b64, image_mime: "image/jpeg", history, memory: activeMemory }) });
      } else {
        let finalTxt = txt;
        if (doc) {
          try {
            const fd = new FormData(); fd.append("file", doc.file, doc.name);
            const extRes = await fetch(`${API}/extract`, { method: "POST", body: fd });
            if (extRes.ok) { const extData = await extRes.json(); finalTxt = `[Attached Document: ${doc.name}]\n\n${extData.text}\n\n${txt}`.trim(); }
            else { finalTxt = `[Attached Document: ${doc.name} (failed to read)]\n\n${txt}`.trim(); }
          } catch (e) { finalTxt = `[Attached Document: ${doc.name} (failed to read)]\n\n${txt}`.trim(); }
        }
        res = await fetch(`${API}/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: finalTxt, history, memory: activeMemory }) });
      }
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const reader = res.body!.getReader(); const dec = new TextDecoder();
      let buf = "", full = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const p = JSON.parse(line.slice(6));
            if (p.token) { full += p.token; const c = full.replace(/\[System:[^\]]*\]/g, "").trim(); setMessages(msgs => msgs.map(m => m.id === sid ? { ...m, text: c } : m)); }
            if (p.image) { setMessages(msgs => msgs.map(m => m.id === sid ? { ...m, image: p.image } : m)); }
            if (p.done) {
              if (settings.soundEnabled) playDone();
              if (settings.ttsEnabled) { setSpeakingId(sid); speakText(full, () => setSpeakingId(null)); }
              if (!isTempChat && p.new_memory?.length > 0) { setMemory(prev => { const merged = [...prev]; for (const item of p.new_memory) { if (item && !merged.includes(item)) merged.push(item); } return merged; }); }
            }
          } catch { }
        }
      }
    } catch (e) {
      setMessages(p => [...p, { id: makeId(), role: "zoro", text: "can't reach the backend — make sure it's running.", timestamp: new Date() }]);
    }
    setLoading(false);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  async function compressImage(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const MAX = 1024; let w = image.width, h = image.height;
        if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(image, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
      };
      image.onerror = () => { const idx = dataUrl.indexOf(","); resolve(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl); };
      image.src = dataUrl;
    });
  }

  const isEmpty = messages.length === 0 && !loading;
  const canSend = (input.trim().length > 0 || !!pendingImg || !!pendingDoc) && !loading;

  return (
    <>
      <style>{CSS}</style>
      <div className="root">
        {/* Sidebar overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {sidebarOpen && (
            <motion.div ref={sbRef} className="sb-wrap"
              initial={{ x: -290 }} animate={{ x: 0 }} exit={{ x: -290 }}
              transition={{ type: "spring", stiffness: 360, damping: 34 }}>
              <Sidebar chats={chats} activeChatId={activeChatId}
                onLoad={loadChat} onDelete={delChat} onNew={newChat}
                onClose={() => setSidebarOpen(false)} user={user} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <header className="hdr">
          <div className="hdr-l">
            <button className="ib" onClick={() => setSidebarOpen(s => !s)}>{Ico.menu}</button>
            <div className="logo">
              <div className="logo-dot" />
              <span className="logo-name">ZORO</span>
            </div>
          </div>
          <div className="hdr-r">
            <div className="mode-tog">
              <button className={`mode-btn${mode === "chat" ? " mode-on" : ""}`} onClick={() => setMode("chat")}>
                {Ico.chat} Chat
              </button>
              <button className={`mode-btn${mode === "voice" ? " mode-on" : ""}`} onClick={() => setMode("voice")}>
                {Ico.mic(false)} Voice
              </button>
            </div>
            {isTempChat && <span className="temp-pill">Temp</span>}
            {user && (
              <>
                <button className={`ib ${showSettings ? 'ib-on' : ''}`} onClick={() => { setShowSettings(s => !s); setShowProfile(false); setShowMem(false); }}>
                  {Ico.settings}
                </button>
                <button
                  className={`hdr-avatar${showProfile ? " hdr-av-open" : ""}`}
                  title={user.displayName || user.email || ""}
                  onClick={() => { setShowProfile(s => !s); setShowSettings(false); setShowMem(false); }}
                >
                  {user.photoURL
                    ? <img src={user.photoURL} alt="" className="hdr-av-img" referrerPolicy="no-referrer" />
                    : <span>{(user.displayName || user.email || "U")[0].toUpperCase()}</span>}
                </button>
              </>
            )}
          </div>
        </header>

        {/* Panels */}
        <AnimatePresence>
          {showMem && (
            <motion.div className="panel-wrap" initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.97 }} transition={{ duration: 0.18 }}>
              <MemPanel memory={memory} onAdd={s => setMemory(p => [...p, s])}
                onDel={i => setMemory(p => p.filter((_, j) => j !== i))} onClose={() => setShowMem(false)} />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showProfile && (
            <motion.div className="panel-wrap prof-panel-wrap" initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.97 }} transition={{ duration: 0.18 }}>
              <ProfileDropdown user={user} settings={settings}
                onChange={s => { setSettings(s); if (!s.ttsEnabled) { stopSpeaking(); setSpeakingId(null); } }}
                onOpenMemory={() => setShowMem(true)} onClose={() => setShowProfile(false)}
                onSignOut={signOut} isTempChat={isTempChat}
                onToggleTemp={() => { setIsTempChat(t => !t); setMessages([]); setActiveChatId(null); }}
                onNewChat={newChat} />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showSettings && (
            <motion.div className="panel-wrap prof-panel-wrap" initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.97 }} transition={{ duration: 0.18 }}>
              <SettingsDropdown settings={settings} onChange={s => { setSettings(s); if (!s.ttsEnabled) { stopSpeaking(); setSpeakingId(null); } }} onClose={() => setShowSettings(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Body */}
        <main className="body">
          <AnimatePresence mode="wait">
            {mode === "voice" ? (
              <motion.div key="voice" className="voice-wrap"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <VoiceMode memory={memory} settings={settings} />
              </motion.div>
            ) : isEmpty ? (
              <motion.div key="empty" className="empty-wrap"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

                {/* ── Welcome Hero ── */}
                <div className="welcome-hero">
                  <motion.p
                    className="welcome-hi"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05, duration: 0.4 }}
                  >
                    Hi, {firstName} ✦
                  </motion.p>
                  <motion.h1
                    className="welcome-heading"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12, duration: 0.4 }}
                  >
                    Where should we begin?
                  </motion.h1>
                </div>

                {/* Pending previews */}
                {pendingImg && (
                  <div className="img-pre-wrap">
                    <div className="img-pre">
                      <img src={pendingImg} alt="" />
                      <button className="img-rm" onPointerDown={e => { e.preventDefault(); setPendingImg(null); }}>{Ico.x(9)}</button>
                    </div>
                  </div>
                )}
                {pendingDoc && (
                  <div className="img-pre-wrap">
                    <div className="doc-pre">
                      <span className="doc-name">{pendingDoc.name}</span>
                      <button className="img-rm" onPointerDown={e => { e.preventDefault(); setPendingDoc(null); }}>{Ico.x(9)}</button>
                    </div>
                  </div>
                )}

                {/* ── Input box ── */}
                <motion.div
                  className="empty-inp-box"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.4 }}
                >
                  <button className="inp-ico" onPointerDown={e => { e.preventDefault(); docFileRef.current?.click(); }} disabled={loading} title="Attach document">{Ico.clip}</button>
                  <button className="inp-ico" onPointerDown={e => { e.preventDefault(); fileRef.current?.click(); }} disabled={loading} title="Attach image">{Ico.img}</button>
                  <textarea ref={taRef} className="inp-ta" value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (!mobile && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder="Ask anything…"
                    disabled={loading} rows={1} autoCapitalize="sentences" spellCheck />
                  <button className={`inp-ico mic-ico${isListening ? " mic-live" : ""}`}
                    onPointerDown={e => { e.preventDefault(); isListening ? stopListen() : startListen(); }}
                    disabled={loading}>{Ico.mic(isListening)}
                  </button>
                  <button className="inp-send" onPointerDown={e => { e.preventDefault(); send(); }} disabled={!canSend}>{Ico.send}</button>
                </motion.div>

                <motion.p
                  className="empty-hint"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3, duration: 0.4 }}
                >
                  {mobile ? "Tap send · mic for voice" : "Enter to send · Shift+Enter for new line"}
                </motion.p>

                {/* ── Suggestion Chips ── */}
                <motion.div
                  className="chips-grid"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35, duration: 0.3 }}
                >
                  {SUGGESTIONS.map((s, i) => (
                    <motion.button
                      key={s.label}
                      className="chip"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.38 + i * 0.06, duration: 0.3 }}
                      onClick={() => {
                        setInput(s.prompt);
                        setTimeout(() => taRef.current?.focus(), 0);
                      }}
                    >
                      <span className="chip-ico">{s.icon}</span>
                      <span className="chip-label">{s.label}</span>
                    </motion.button>
                  ))}
                </motion.div>
              </motion.div>
            ) : (
              <motion.div key="chat" className="chat-scroll"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
                <div className="chat-inner">
                  <AnimatePresence initial={false}>
                    {messages.map((msg, i, arr) => {
                      const isLastZoro = msg.role === "zoro" && i === arr.length - 1;
                      return (
                        <Bubble key={msg.id} msg={msg}
                          onPin={id => setMessages(p => p.map(m => m.id === id ? { ...m, pinned: !m.pinned } : m))}
                          onSpeak={handleSpeak}
                          onRegenerate={handleRegenerate}
                          speaking={speakingId === msg.id}
                          tts={settings.ttsEnabled}
                          isLastZoro={isLastZoro} />
                      );
                    })}
                  </AnimatePresence>
                  <div ref={bottomRef} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Footer input — chat mode, non-empty */}
        {mode === "chat" && !isEmpty && (
          <footer className="foot">
            {pendingImg && (
              <div className="img-pre-wrap">
                <div className="img-pre">
                  <img src={pendingImg} alt="" />
                  <button className="img-rm" onPointerDown={e => { e.preventDefault(); setPendingImg(null); }}>{Ico.x(9)}</button>
                </div>
              </div>
            )}
            {pendingDoc && (
              <div className="img-pre-wrap">
                <div className="doc-pre">
                  <span className="doc-name">{pendingDoc.name}</span>
                  <button className="img-rm" onPointerDown={e => { e.preventDefault(); setPendingDoc(null); }}>{Ico.x(9)}</button>
                </div>
              </div>
            )}
            <div className="inp-box">
              <button className="inp-ico" onPointerDown={e => { e.preventDefault(); docFileRef.current?.click(); }} disabled={loading} title="Document">{Ico.clip}</button>
              <button className="inp-ico" onPointerDown={e => { e.preventDefault(); cameraRef.current?.click(); }} disabled={loading} title="Camera">{Ico.camera}</button>
              <button className="inp-ico" onPointerDown={e => { e.preventDefault(); fileRef.current?.click(); }} disabled={loading} title="Image">{Ico.img}</button>
              <textarea ref={taRef} className="inp-ta" value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (!mobile && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={isListening ? "Listening…" : "Message ZORO…"}
                disabled={loading} rows={1} autoCapitalize="sentences" spellCheck />
              <button className={`inp-ico mic-ico${isListening ? " mic-live" : ""}`}
                onPointerDown={e => { e.preventDefault(); isListening ? stopListen() : startListen(); }}
                disabled={loading}>{Ico.mic(isListening)}</button>
              <button className="inp-send" onPointerDown={e => { e.preventDefault(); send(); }} disabled={!canSend}>{Ico.send}</button>
            </div>
            <p className="foot-hint">{mobile ? "Tap send · mic for voice" : "Enter to send · Shift+Enter for new line"}</p>
          </footer>
        )}

        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setPendingImg(r.result as string); setPendingDoc(null); }; r.readAsDataURL(f); e.target.value = ""; }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setPendingImg(r.result as string); setPendingDoc(null); }; r.readAsDataURL(f); e.target.value = ""; }} />
        <input ref={docFileRef} type="file" accept="*/*" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (!f) return; setPendingDoc({ name: f.name, file: f }); setPendingImg(null); e.target.value = ""; }} />
      </div>
    </>
  );
}

// ─── CSS — Premium Redesign ───────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,400&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Light Mode Variables ───────────────────────────────────────────────────── */
:root {
  --bg:           #f7f4ef;
  --bg2:          #f0ece4;
  --surface:      #ffffff;
  --surface-2:    #faf8f4;
  --border:       #e8e1d6;
  --border-2:     #ddd5c8;

  --text:         #1e1b17;
  --text-2:       #7a7268;
  --text-3:       #b0a89e;

  --accent:       #b07d5a;
  --accent-2:     #c99070;
  --accent-light: rgba(176,125,90,.10);
  --accent-glow:  rgba(176,125,90,.20);

  --user-bg:      #1e1b17;
  --user-fg:      #f7f4ef;
  --zoro-bg:      #f0ece4;
  --zoro-fg:      #1e1b17;

  --font:         'DM Sans', system-ui, sans-serif;
  --font-display: 'Playfair Display', Georgia, serif;
  --mono:         'JetBrains Mono', monospace;

  --sb-w:         272px;
  --hdr-h:        58px;
  --radius:       18px;
  --radius-sm:    10px;

  --shadow-sm:    0 1px 6px rgba(0,0,0,.06);
  --shadow:       0 2px 16px rgba(0,0,0,.08);
  --shadow-lg:    0 8px 40px rgba(0,0,0,.12);
  --shadow-xl:    0 20px 60px rgba(0,0,0,.15);
}

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.root {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
  position: relative;
}

/* ── Overlay ────────────────────────────────────────────────────────────────── */
.overlay {
  position: fixed; inset: 0;
  background: rgba(30,27,23,.35);
  backdrop-filter: blur(2px);
  z-index: 40;
}

/* ── Sidebar ────────────────────────────────────────────────────────────────── */
.sb-wrap {
  position: fixed; top: 0; left: 0;
  height: 100dvh; z-index: 50;
}
.sb {
  width: var(--sb-w); height: 100%;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-xl);
}
.sb-top {
  padding: 16px 14px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.sb-brand {
  display: flex; align-items: center; gap: 9px;
  font-family: var(--font-display); font-weight: 600; font-size: 16px;
  color: var(--text); letter-spacing: .01em;
}
.sb-dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 0 8px var(--accent-glow);
}
.sb-new {
  display: flex; align-items: center; gap: 8px;
  margin: 12px 10px 6px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1.5px dashed var(--border-2);
  background: transparent;
  color: var(--text-2);
  font-family: var(--font); font-size: 13.5px; font-weight: 500;
  cursor: pointer; transition: all .18s;
}
.sb-new:hover {
  background: var(--accent-light);
  border-color: var(--accent);
  color: var(--accent);
}
.sb-new-ico { display: flex; align-items: center; }
.sb-list { flex: 1; overflow-y: auto; padding: 4px 8px 12px; }
.sb-list::-webkit-scrollbar { width: 3px; }
.sb-list::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 3px; }
.sb-empty-state { display: flex; flex-direction: column; align-items: center; padding: 32px 16px; gap: 8px; }
.sb-empty-icon { font-size: 28px; opacity: .4; }
.sb-empty { font-size: 13px; color: var(--text-2); font-weight: 500; }
.sb-empty-sub { font-size: 12px; color: var(--text-3); text-align: center; line-height: 1.5; }
.sb-gl {
  font-size: 10px; font-weight: 600; color: var(--text-3);
  text-transform: uppercase; letter-spacing: .08em;
  padding: 12px 7px 5px;
}
.sb-item {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 8px 9px 10px;
  border-radius: 10px; cursor: pointer;
  font-size: 13px; color: var(--text);
  border: 1px solid transparent; margin-bottom: 1px;
  transition: all .14s;
}
.sb-item:hover { background: var(--bg2); }
.sb-active {
  background: var(--accent-light);
  border-color: rgba(176,125,90,.2);
  color: var(--accent);
}
.sb-i-ico { color: var(--text-3); flex-shrink: 0; }
.sb-active .sb-i-ico { color: var(--accent); opacity: .7; }
.sb-i-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-del {
  width: 22px; height: 22px; border: none; background: transparent;
  color: var(--text-3); cursor: pointer; border-radius: 6px;
  display: none; align-items: center; justify-content: center;
  padding: 0; transition: all .1s;
}
.sb-item:hover .sb-del { display: flex; }
.sb-del:hover { background: var(--border-2); color: var(--text); }

/* Sidebar user footer */
.sb-user {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}
.sb-user-av {
  width: 32px; height: 32px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
  background: var(--accent-light); color: var(--accent);
  font-size: 13px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px solid var(--border);
}
.sb-user-av-img { width: 100%; height: 100%; object-fit: cover; }
.sb-user-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.sb-user-name { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sb-user-email { font-size: 11px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Header ─────────────────────────────────────────────────────────────────── */
.hdr {
  flex-shrink: 0; height: var(--hdr-h);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px;
  background: rgba(247,244,239,.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
  position: relative; z-index: 10;
}
.hdr-l, .hdr-r { display: flex; align-items: center; gap: 8px; }
.logo {
  display: flex; align-items: center; gap: 8px;
  font-family: var(--font-display); font-weight: 500;
  font-size: 17px; color: var(--text); letter-spacing: .01em;
}
.logo-dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 0 8px var(--accent-glow);
}

/* ── Icon Buttons ───────────────────────────────────────────────────────────── */
.ib {
  width: 34px; height: 34px; border-radius: 10px; border: none; background: transparent;
  color: var(--text-2); cursor: pointer; display: flex; align-items: center;
  justify-content: center; transition: all .14s;
  -webkit-tap-highlight-color: transparent; flex-shrink: 0;
}
.ib:hover { background: var(--bg2); color: var(--text); }
.ib-on { background: var(--accent-light); color: var(--accent); }
.ib-on:hover { background: var(--accent-light); color: var(--accent); }

/* Mode toggle */
.mode-tog {
  display: flex; align-items: center;
  background: var(--bg2); border-radius: 12px; padding: 3px; gap: 2px;
  border: 1px solid var(--border);
}
.mode-btn {
  display: flex; align-items: center; gap: 6px; padding: 5px 13px;
  border-radius: 9px; border: none; background: transparent; color: var(--text-2);
  font-family: var(--font); font-size: 12.5px; font-weight: 500; cursor: pointer;
  transition: all .16s; -webkit-tap-highlight-color: transparent;
}
.mode-on {
  background: var(--surface); color: var(--text);
  box-shadow: var(--shadow-sm);
}

/* Temp pill */
.temp-pill {
  font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 20px;
  background: var(--accent-light); color: var(--accent);
  border: 1px solid rgba(176,125,90,.25);
  letter-spacing: .06em; text-transform: uppercase;
}

/* Header avatar */
.hdr-avatar {
  width: 32px; height: 32px; border-radius: 50%; overflow: hidden;
  background: var(--accent-light); color: var(--accent);
  font-size: 13px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; border: 2px solid var(--border); cursor: pointer;
  transition: all .16s; padding: 0;
}
.hdr-avatar:hover,
.hdr-av-open {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.hdr-av-img { width: 100%; height: 100%; object-fit: cover; }

/* ── Panels ──────────────────────────────────────────────────────────────────── */
.panel-wrap {
  position: absolute; top: calc(var(--hdr-h) + 10px);
  right: 16px; z-index: 30;
}
.prof-panel-wrap { right: 12px; }
.panel {
  width: 300px; background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}
.panel-hd {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--border);
}
.panel-title { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; color: var(--text); }
.panel-hint { font-size: 12px; color: var(--text-2); padding: 10px 16px 4px; line-height: 1.5; }
.mem-list { max-height: 160px; overflow-y: auto; padding: 6px 10px; display: flex; flex-direction: column; gap: 5px; }
.mem-empty { font-size: 12px; color: var(--text-3); text-align: center; padding: 16px 0; }
.mem-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  background: var(--bg2); border-radius: 9px; font-size: 12.5px; color: var(--text);
  border: 1px solid var(--border);
}
.mem-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mem-del {
  width: 18px; height: 18px; border: none; background: transparent; color: var(--text-3);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  padding: 0; border-radius: 5px;
}
.mem-del:hover { background: var(--border); }
.panel-inp-row { display: flex; gap: 8px; padding: 10px 10px 12px; border-top: 1px solid var(--border); }
.panel-inp {
  flex: 1; border: 1.5px solid var(--border); border-radius: 10px;
  background: var(--bg2); color: var(--text); font-family: var(--font);
  font-size: 13px; padding: 8px 11px; outline: none; transition: border-color .14s;
}
.panel-inp:focus { border-color: var(--accent); }
.panel-add {
  padding: 8px 14px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff; font-family: var(--font); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: opacity .12s;
}
.panel-add:hover { opacity: .85; }

/* Settings rows */
.set-list { padding: 4px 0 6px; }
.set-row {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 12px 16px; cursor: pointer; border-bottom: 1px solid var(--border);
}
.set-row:last-child { border-bottom: none; }
.temp-row { border-bottom: none !important; }
.set-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.set-icon { margin-right: 6px; font-size: 14px; }
.set-label { font-size: 13px; font-weight: 500; color: var(--text); }
.set-desc { font-size: 11.5px; color: var(--text-2); line-height: 1.4; }
.tog { width: 40px; height: 23px; border-radius: 12px; background: var(--border-2); position: relative; cursor: pointer; transition: background .2s; flex-shrink: 0; }
.tog-on { background: var(--accent); }
.tog-thumb { position: absolute; top: 3px; left: 3px; width: 17px; height: 17px; border-radius: 50%; background: #fff; transition: transform .22s; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
.tog-on .tog-thumb { transform: translateX(17px); }

/* Profile dropdown */
.prof-drop {
  width: 308px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 20px;
  box-shadow: var(--shadow-xl); overflow: hidden;
}
.prof-user { display: flex; align-items: center; gap: 12px; padding: 15px 15px 15px 16px; }
.prof-av {
  width: 42px; height: 42px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
  background: linear-gradient(135deg, var(--accent-light), var(--bg2));
  color: var(--accent); font-size: 17px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--border);
}
.prof-av-img { width: 100%; height: 100%; object-fit: cover; }
.prof-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.prof-name { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prof-email { font-size: 11.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prof-divider { height: 1px; background: var(--border); }
.prof-section-label { font-size: 10px; font-weight: 700; color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; padding: 10px 16px 3px; }
.prof-action {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 11px 14px 11px 16px; border: none; background: transparent;
  cursor: pointer; text-align: left; transition: background .12s;
  -webkit-tap-highlight-color: transparent;
}
.prof-action:hover { background: var(--bg2); }
.prof-action-ico { color: var(--text-2); display: flex; align-items: center; flex-shrink: 0; }
.prof-action-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.prof-action-label { font-size: 13.5px; font-weight: 500; color: var(--text); }
.prof-action-desc { font-size: 11.5px; color: var(--text-2); }
.prof-action-arr { font-size: 20px; color: var(--text-3); line-height: 1; }
.set-signout-wrap { padding: 10px 14px 14px; }
.set-signout {
  width: 100%; padding: 10px; border-radius: 11px;
  border: 1.5px solid rgba(200,60,60,.25);
  background: transparent; color: #c0392b;
  font-family: var(--font); font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all .14s;
}
.set-signout:hover { background: rgba(200,60,60,.06); }

/* ── Body ────────────────────────────────────────────────────────────────────── */
.body { flex: 1; overflow: hidden; position: relative; }

/* ── Welcome / Empty State ───────────────────────────────────────────────────── */
.empty-wrap {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 32px 24px; gap: 20px; overflow-y: auto;
}

/* Radial ambient glow behind the heading */
.empty-wrap::before {
  content: '';
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -62%);
  width: 600px; height: 400px;
  background: radial-gradient(ellipse at center, var(--accent-glow) 0%, transparent 70%);
  pointer-events: none; z-index: 0;
}

.welcome-hero { position: relative; z-index: 1; text-align: center; }

.welcome-hi {
  font-family: var(--font); font-size: 15px; font-weight: 500;
  color: var(--accent); letter-spacing: .02em; margin-bottom: 10px;
}

.welcome-heading {
  font-family: var(--font-display);
  font-size: clamp(30px, 5vw, 52px);
  font-weight: 500; line-height: 1.15;
  letter-spacing: -.02em; color: var(--text);
  max-width: 560px;
}

/* ── Empty input ────────────────────────────────────────────────────────────── */
.empty-inp-box {
  position: relative; z-index: 1;
  width: 100%; max-width: 640px;
  display: flex; align-items: flex-end; gap: 6px;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 22px;
  padding: 10px 10px 10px 14px;
  box-shadow: var(--shadow-lg);
  transition: border-color .18s, box-shadow .18s;
}
.empty-inp-box:focus-within {
  border-color: rgba(176,125,90,.5);
  box-shadow: var(--shadow-lg), 0 0 0 4px var(--accent-light);
}
.empty-hint {
  position: relative; z-index: 1;
  font-size: 11px; color: var(--text-3); letter-spacing: .01em;
}

/* ── Suggestion Chips ────────────────────────────────────────────────────────── */
.chips-grid {
  position: relative; z-index: 1;
  display: flex; flex-wrap: wrap;
  justify-content: center; gap: 10px;
  max-width: 640px; width: 100%;
}
.chip {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 18px;
  border-radius: 100px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-family: var(--font); font-size: 13.5px; font-weight: 500;
  cursor: pointer;
  transition: all .18s;
  box-shadow: var(--shadow-sm);
  -webkit-tap-highlight-color: transparent;
}
.chip:hover {
  border-color: var(--accent);
  background: var(--accent-light);
  color: var(--accent);
  box-shadow: var(--shadow), 0 0 0 3px var(--accent-light);
  transform: translateY(-1px);
}
.chip:active { transform: translateY(0); }
.chip-ico { font-size: 16px; line-height: 1; }
.chip-label { white-space: nowrap; }

/* ── Chat Scroll ──────────────────────────────────────────────────────────────── */
.chat-scroll { height: 100%; overflow-y: auto; overscroll-behavior: contain; }
.chat-scroll::-webkit-scrollbar { width: 4px; }
.chat-scroll::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 4px; }
.chat-inner { max-width: 740px; margin: 0 auto; padding: 24px 20px 12px; display: flex; flex-direction: column; gap: 6px; }

/* ── Bubbles ───────────────────────────────────────────────────────────────── */
.bubble-row { display: flex; gap: 10px; padding: 5px 0; align-items: flex-start; }
.u-row { flex-direction: row-reverse; }
.pinned .bubble { outline: 2px solid var(--accent) !important; outline-offset: 2px; }

.avatar {
  width: 30px; height: 30px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; flex-shrink: 0; margin-top: 2px;
  letter-spacing: .01em;
}
.z-av { background: var(--accent-light); color: var(--accent); border: 1px solid rgba(176,125,90,.2); }
.u-av { background: var(--user-bg); color: var(--user-fg); }

.bwrap { display: flex; flex-direction: column; gap: 4px; max-width: min(76%, 560px); }
.u-wrap { align-items: flex-end; }
.pin-tag { font-size: 10.5px; color: var(--accent); font-weight: 600; padding-left: 2px; }

.bubble {
  padding: 11px 16px; border-radius: 18px;
  font-size: 14.5px; line-height: 1.68; word-break: break-word;
}
.z-bubble {
  background: var(--zoro-bg); color: var(--zoro-fg);
  border-bottom-left-radius: 5px;
  border: 1px solid var(--border);
}
.u-bubble {
  background: var(--user-bg); color: var(--user-fg);
  border-bottom-right-radius: 5px;
}

/* Image in bubble */
.bubble-img-container { position: relative; width: 100%; max-width: 320px; border-radius: 12px; overflow: hidden; margin-bottom: 8px; box-shadow: 0 4px 18px rgba(0,0,0,0.12); border: 1px solid var(--border); }
.b-img { display: block; width: 100%; height: auto; transition: transform .3s; }
.bubble-img-container:hover .b-img { transform: scale(1.02); }
.img-overlay { position: absolute; inset: 0; background: rgba(0,0,0,.22); display: flex; align-items: center; justify-content: center; gap: 12px; opacity: 0; transition: opacity .2s; backdrop-filter: blur(3px); }
.bubble-img-container:hover .img-overlay { opacity: 1; }
.img-btn { width: 38px; height: 38px; border-radius: 50%; border: none; background: rgba(255,255,255,.92); color: #1e1b17; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,.15); transition: transform .14s; }
.img-btn:hover { transform: scale(1.1); }

/* Doc card */
.b-doc-card { display: flex; align-items: center; gap: 9px; padding: 10px 14px; background: rgba(0,0,0,.04); border-radius: 10px; text-decoration: none; color: inherit; margin-bottom: 6px; border: 1px solid var(--border); transition: background .14s; }
.b-doc-card:hover { background: rgba(0,0,0,.07); }
.b-doc-ico { opacity: .6; display: flex; align-items: center; }
.b-doc-name { font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }

/* Code */
.z-code { background: rgba(0,0,0,.05); border-radius: 10px; padding: 11px 14px; font-family: var(--mono); font-size: 12.5px; overflow-x: auto; margin: 7px 0; border: 1px solid var(--border); }
.z-ic { font-family: var(--mono); font-size: 12.5px; background: rgba(0,0,0,.06); border-radius: 4px; padding: 1px 5px; }

/* Bubble meta */
.bmeta { display: flex; align-items: center; gap: 3px; opacity: 0; transition: opacity .15s; padding: 0 2px; }
.bubble-row:hover .bmeta { opacity: 1; }
.btime { font-size: 10.5px; color: var(--text-3); }
.bact {
  width: 22px; height: 22px; border-radius: 6px; border: none; background: transparent;
  color: var(--text-3); cursor: pointer; display: flex; align-items: center; justify-content: center;
  padding: 0; transition: all .12s;
}
.bact:hover { background: var(--border); color: var(--text); }
.bact-on { color: var(--accent); }

/* Typing dots */
.typing { display: flex; gap: 5px; align-items: center; padding: 3px 0; height: 22px; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); animation: bounce .95s ease-in-out infinite; }
.typing span:nth-child(2) { animation-delay: .16s; }
.typing span:nth-child(3) { animation-delay: .32s; }
@keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

/* ── Footer ──────────────────────────────────────────────────────────────────── */
.foot {
  flex-shrink: 0; padding: 10px 20px 14px;
  background: rgba(247,244,239,.9);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid var(--border);
}
.img-pre-wrap { max-width: 700px; margin: 0 auto 8px; }
.img-pre { position: relative; display: inline-block; }
.img-pre img { height: 72px; max-width: 110px; border-radius: 10px; object-fit: cover; border: 1px solid var(--border); }
.doc-pre { position: relative; display: inline-flex; align-items: center; padding: 11px 18px; border-radius: 10px; border: 1.5px solid var(--border); background: var(--bg2); font-size: 13px; color: var(--text); }
.doc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; font-weight: 500; }
.img-rm { position: absolute; top: -7px; right: -7px; width: 20px; height: 20px; border-radius: 50%; background: var(--text); color: var(--bg); border: 2px solid var(--bg); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }

.inp-box {
  max-width: 700px; margin: 0 auto;
  display: flex; align-items: flex-end; gap: 6px;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 18px;
  padding: 9px 9px 9px 12px;
  box-shadow: var(--shadow-sm);
  transition: border-color .18s, box-shadow .18s;
}
.inp-box:focus-within {
  border-color: rgba(176,125,90,.4);
  box-shadow: var(--shadow), 0 0 0 3px var(--accent-light);
}
.inp-ta {
  flex: 1; border: none; outline: none; background: transparent;
  font-family: var(--font); font-size: 14.5px; color: var(--text);
  line-height: 1.55; resize: none; min-height: 24px; max-height: 150px;
  overflow-y: auto; padding: 1px 0;
}
.inp-ta::placeholder { color: var(--text-3); }
.inp-ta::-webkit-scrollbar { width: 0; }
.inp-ico {
  width: 36px; height: 36px; border-radius: 11px; border: none; background: transparent;
  color: var(--text-2); cursor: pointer; display: flex; align-items: center;
  justify-content: center; flex-shrink: 0; align-self: flex-end;
  transition: all .14s; -webkit-tap-highlight-color: transparent;
}
.inp-ico:hover { background: var(--bg2); color: var(--text); }
.inp-ico:disabled { opacity: .3; cursor: not-allowed; }
.mic-live {
  color: #c0392b; background: rgba(192,57,43,.1);
  animation: mic-pulse 1.1s ease-in-out infinite;
}
@keyframes mic-pulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(192,57,43,.25); }
  50% { box-shadow: 0 0 0 8px rgba(192,57,43,0); }
}
.inp-send {
  width: 36px; height: 36px; border-radius: 11px; border: none;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; align-self: flex-end;
  transition: opacity .14s, transform .1s, box-shadow .14s;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  box-shadow: 0 2px 10px var(--accent-glow);
}
.inp-send:hover:not(:disabled) { opacity: .9; transform: scale(1.05); box-shadow: 0 4px 16px var(--accent-glow); }
.inp-send:active:not(:disabled) { transform: scale(.93); }
.inp-send:disabled { opacity: .2; cursor: not-allowed; box-shadow: none; }
.foot-hint { text-align: center; font-size: 11px; color: var(--text-3); margin-top: 8px; max-width: 700px; margin-left: auto; margin-right: auto; letter-spacing: .01em; }

/* ── Voice Mode ──────────────────────────────────────────────────────────────── */
.voice-wrap { height: 100%; display: flex; align-items: center; justify-content: center; }
.voice-shell { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 24px 20px; width: 100%; max-width: 440px; }
.orb-area { position: relative; width: 130px; height: 130px; display: flex; align-items: center; justify-content: center; }
.orb-ring { position: absolute; inset: 0; border-radius: 50%; background: var(--accent-glow); }
.orb {
  position: relative; z-index: 2; width: 118px; height: 118px; border-radius: 50%;
  border: 2px solid var(--border-2); background: var(--surface); color: var(--text-2);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all .2s; -webkit-tap-highlight-color: transparent; box-shadow: var(--shadow);
}
.orb:disabled { opacity: .5; cursor: not-allowed; }
.orb-live { border-color: var(--accent); background: var(--accent-light); color: var(--accent); box-shadow: var(--shadow), 0 0 30px var(--accent-glow); }
.orb-spin { width: 32px; height: 32px; border-radius: 50%; border: 2.5px solid var(--border-2); border-top-color: var(--accent); }
.orb-label { font-size: 13.5px; color: var(--text-2); letter-spacing: .02em; }
.voice-cards { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.vcard { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px 16px; }
.vc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
.vc-who { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: var(--text-3); margin-bottom: 7px; }
.zvc-who { color: var(--accent); margin-bottom: 0; }
.vc-text { font-size: 15.5px; color: var(--text); line-height: 1.55; }
.err-card { border-color: rgba(192,57,43,.3); }
.err-card .vc-text { color: #c0392b; }

/* ── Mobile ──────────────────────────────────────────────────────────────────── */
@media (max-width: 500px) {
  .chat-inner { padding: 14px 12px 8px; }
  .bubble { font-size: 14.5px; }
  .welcome-heading { font-size: 28px; }
  .welcome-hi { font-size: 14px; }
  .foot-hint { display: none; }
  .panel-wrap { right: 8px; left: 8px; }
  .panel, .prof-drop { width: 100%; }
  .chips-grid { gap: 8px; }
  .chip { padding: 9px 15px; font-size: 13px; }
  .orb { width: 100px; height: 100px; }
  .orb-area { width: 110px; height: 110px; }
  .empty-wrap { gap: 16px; padding: 24px 16px; }
}

/* ══ DARK MODE ═══════════════════════════════════════════════════════════════ */
.dark {
  --bg:           #0f0e0c;
  --bg2:          #171411;
  --surface:      #1c1916;
  --surface-2:    #211e1a;
  --border:       #2c2720;
  --border-2:     #38322a;

  --text:         #ede5d8;
  --text-2:       #8a7f73;
  --text-3:       #4e4740;

  --accent:       #c9906a;
  --accent-2:     #dea880;
  --accent-light: rgba(201,144,106,.10);
  --accent-glow:  rgba(201,144,106,.22);

  --user-bg:      #c9906a;
  --user-fg:      #0f0e0c;
  --zoro-bg:      #1c1916;
  --zoro-fg:      #ede5d8;

  --shadow-sm:    0 1px 6px rgba(0,0,0,.3);
  --shadow:       0 2px 16px rgba(0,0,0,.4);
  --shadow-lg:    0 8px 40px rgba(0,0,0,.5);
  --shadow-xl:    0 20px 60px rgba(0,0,0,.6);
}

.dark body,
.dark .root { background: var(--bg); color: var(--text); }

.dark .hdr {
  background: rgba(15,14,12,.85);
  border-bottom-color: var(--border);
}
.dark .sb { background: var(--surface); border-right-color: var(--border); }
.dark .sb-user { background: var(--bg2); border-top-color: var(--border); }
.dark .inp-box { background: var(--surface); border-color: var(--border); }
.dark .empty-inp-box { background: var(--surface); border-color: var(--border); }
.dark .foot { background: rgba(15,14,12,.88); border-top-color: var(--border); }
.dark .panel { background: var(--surface); border-color: var(--border); }
.dark .prof-drop { background: var(--surface); border-color: var(--border); }
.dark .mode-tog { background: var(--bg2); border-color: var(--border); }
.dark .mode-on { background: var(--surface-2); box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.dark .chip { background: var(--surface); border-color: var(--border); }
.dark .chip:hover { background: var(--accent-light); border-color: var(--accent); }
.dark .vcard { background: var(--surface); border-color: var(--border); }
.dark .orb { background: var(--surface); border-color: var(--border); }
.dark .z-code { background: rgba(255,255,255,.04); border-color: var(--border); }
.dark .z-ic { background: rgba(255,255,255,.06); }
.dark .mem-item { background: var(--bg2); border-color: var(--border); }
.dark .z-bubble { border-color: var(--border); }
.dark .sb-new:hover { background: var(--accent-light); border-color: var(--accent); }
.dark .b-doc-card { background: rgba(255,255,255,.04); border-color: var(--border); }
.dark .b-doc-card:hover { background: rgba(255,255,255,.07); }
.dark .img-btn { background: rgba(28,25,22,.92); color: var(--text); }
.dark .welcome-heading { color: var(--text); }
.dark .hdr-avatar { border-color: var(--border); }
`;