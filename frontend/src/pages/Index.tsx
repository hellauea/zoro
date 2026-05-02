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

// ─── Constants ────────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_URL as string;

const SUGGESTIONS = [
  "What's something cool I should know?",
  "Give me a book recommendation",
  "Tell me a fun fact",
  "Help me think through something",
  "Roast me gently",
  "What's a good habit to start?",
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
  clip: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>,
  camera: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>,
};

// ─── Message Bubble ───────────────────────────────────────────────────────────

function Bubble({ msg, onPin, onSpeak, onRegenerate, speaking, tts, isLastZoro }: {
  msg: Message; onPin: (id: string) => void;
  onSpeak: (text: string, id: string) => void;
  onRegenerate: (id: string) => void;
  speaking: boolean; tts: boolean; isLastZoro: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isZ = msg.role === "zoro";
  const time = msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const copy = () => {
    navigator.clipboard.writeText(msg.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={`bubble-row ${isZ ? "z-row" : "u-row"}${msg.pinned ? " pinned" : ""}`}
    >
      <div className={`avatar ${isZ ? "z-av" : "u-av"}`}>
        {isZ ? "Z" : "U"}
      </div>
      <div className={`bwrap ${isZ ? "z-wrap" : "u-wrap"}`}>
        {msg.pinned && <span className="pin-tag">📌 pinned</span>}
        <div className={`bubble ${isZ ? "z-bubble" : "u-bubble"}`}>
          {msg.image && <img src={msg.image} alt="" className="b-img" />}
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
      {/* Orb */}
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

function Sidebar({ chats, activeChatId, onLoad, onDelete, onNew, onClose }: {
  chats: Chat[]; activeChatId: string | null;
  onLoad: (c: Chat) => void; onDelete: (id: string) => void;
  onNew: () => void; onClose: () => void;
}) {
  const grouped = groupByDate(chats);
  return (
    <div className="sb">
      <div className="sb-top">
        <div className="sb-brand">
          <div className="sb-dot" />
          <span>ZORO</span>
        </div>
        <button className="ib" onClick={onClose}>{Ico.x(13)}</button>
      </div>
      <button className="sb-new" onClick={onNew}>{Ico.plus} New chat</button>
      <div className="sb-list">
        {chats.length === 0
          ? <p className="sb-empty">No chats yet. Start talking!</p>
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
  const settingRows: { key: keyof Settings; label: string; desc: string; icon: string }[] = [
    { key: "soundEnabled", label: "Completion chime", desc: "Soft sound when ZORO finishes", icon: "🔔" },
    { key: "ttsEnabled", label: "Voice replies", desc: "Read responses aloud via ElevenLabs", icon: "🎙️" },
    { key: "storeHistory", label: "Save history", desc: "Sync chats to the cloud", icon: "☁️" },
    { key: "darkMode", label: "Dark mode", desc: "Switch to dark theme", icon: "🌙" },
  ];
  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const initial = displayName[0].toUpperCase();

  return (
    <div className="prof-drop">
      {/* User info */}
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



      {/* Actions */}
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

      {/* Temporary chat */}
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

      {/* Sign out */}
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

  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [pendingImg, setPendingImg] = useState<string | null>(null);
  const [pendingDoc, setPendingDoc] = useState<{name: string, file: File} | null>(null);
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

  // ── Load data from Firestore on mount ──
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const [c, m, s] = await Promise.all([
        floadChats(uid), floadMemory(uid), loadUserSettings(uid),
      ]);
      if (cancelled) return;
      setChats(c); setMemory(m); setSettings(s); setDataLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [uid]);

  // ── Apply dark mode class ──
  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  // ── Save memory to Firestore (debounced) ──
  useEffect(() => {
    if (!uid || !dataLoaded) return;
    const t = setTimeout(() => fsaveMemory(uid, memory), 600);
    return () => clearTimeout(t);
  }, [memory, uid, dataLoaded]);

  // ── Save settings to Firestore (debounced) ──
  useEffect(() => {
    if (!uid || !dataLoaded) return;
    const t = setTimeout(() => saveUserSettings(uid, settings), 600);
    return () => clearTimeout(t);
  }, [settings, uid, dataLoaded]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (sidebarOpen && sbRef.current && !sbRef.current.contains(e.target as Node)) setSidebarOpen(false);
      // If clicking outside panels, close them. Simple implementation: any click closes them unless it's on a panel.
      const t = e.target as HTMLElement;
      if (!t.closest('.prof-panel-wrap') && !t.closest('.hdr-r')) {
        setShowProfile(false);
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [sidebarOpen]);

  // ── Save chat to Firestore when messages change ──
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
    // Find the last user message text
    const lastUserMsg = [...prevMsgs].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
       // Re-trigger send but bypass normal txt logic. We will resend the exact state.
       setLoading(true);
       const history = prevMsgs.slice(-20).map(m => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
       try {
         const sid = makeId();
         setMessages(p => [...p, { id: sid, role: "zoro", text: "", timestamp: new Date() }]);
         
         const res = await fetch(`${API}/stream`, {
           method: "POST", headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ text: " ", history, memory: isTempChat ? [] : memory }),
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
               if (p.token) { full += p.token; const c = full.replace(/\[System:[^\]]*\]/g, "").trim(); setMessages(msgs => msgs.map(m => m.id === sid ? { ...m, text: c } : m)); }
               if (p.done) {
                 if (settings.soundEnabled) playDone();
                 if (settings.ttsEnabled) { setSpeakingId(sid); speakText(full, () => setSpeakingId(null)); }
               }
             } catch { }
           }
         }
       } catch {
         setMessages(p => [...p, { id: makeId(), role: "zoro", text: "can't reach the backend — make sure it's running.", timestamp: new Date() }]);
       }
       setLoading(false);
    }
  };

  const send = async (override?: string) => {
    const txt = (override ?? input).trim();
    if ((!txt && !pendingImg && !pendingDoc) || loading) return;

    // Start loading and clear input immediately for responsiveness
    setLoading(true);
    stopSpeaking(); 
    setSpeakingId(null);
    
    const doc = pendingDoc;
    const img = pendingImg;
    
    // Clear inputs immediately
    setInput("");
    setPendingImg(null);
    setPendingDoc(null);

    let docUrl = "";
    if (doc && uid) {
      try { 
        docUrl = await uploadDocument(uid, doc.file); 
      } catch (e) { 
        console.error("Upload failed:", e); 
      }
    }

    const userMsg: Message = { 
      id: makeId(), 
      role: "user", 
      text: txt || (doc ? doc.name : ""), 
      image: img ?? undefined, 
      document: docUrl ? { name: doc.name, url: docUrl } : undefined, 
      timestamp: new Date() 
    };

    const next = [...messages, userMsg];
    setMessages(next);
    
    const history = next.slice(-20).map(m => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
    const activeMemory = isTempChat ? [] : memory;

    try {
      const sid = makeId();
      setMessages(p => [...p, { id: sid, role: "zoro", text: "", timestamp: new Date() }]);
      
      let finalTxt = txt;
      if (doc) {
        try {
          const fd = new FormData();
          fd.append("file", doc.file, doc.name);
          const extRes = await fetch(`${API}/extract`, { method: "POST", body: fd });
          if (extRes.ok) {
             const extData = await extRes.json();
             finalTxt = `[Attached Document: ${doc.name}]\n\n${extData.text}\n\n${txt}`.trim();
          } else {
             finalTxt = `[Attached Document: ${doc.name} (failed to read)]\n\n${txt}`.trim();
          }
        } catch (e) { 
          console.error("Extraction error:", e);
          finalTxt = `[Attached Document: ${doc.name} (failed to read)]\n\n${txt}`.trim(); 
        }
      }

      // Handle image if present — compress to avoid huge payloads
      let image_base64: string | null = null;
      let image_mime = "image/jpeg";
      if (userMsg.image) {
        try {
          // Compress image using canvas to max 1024px
          const compressed = await new Promise<string>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const MAX = 1024;
              let w = img.width, h = img.height;
              if (w > MAX || h > MAX) {
                if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                else { w = Math.round(w * MAX / h); h = MAX; }
              }
              const c = document.createElement("canvas");
              c.width = w; c.height = h;
              c.getContext("2d")!.drawImage(img, 0, 0, w, h);
              resolve(c.toDataURL("image/jpeg", 0.85));
            };
            img.onerror = () => resolve(userMsg.image!); // fallback to original
            img.src = userMsg.image!;
          });
          image_base64 = compressed.split(",")[1];
          image_mime = "image/jpeg";
          console.log("Image compressed, base64 length:", image_base64.length);
        } catch {
          // Fallback: use raw data
          image_base64 = userMsg.image.split(",")[1];
          image_mime = (userMsg.image.match(/^data:([^;]+);/) || [])[1] || "image/jpeg";
        }
      }

      const res = await fetch(`${API}/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          text: finalTxt || "what do you see in this image?", 
          image_base64, 
          image_mime, 
          history, 
          memory: activeMemory 
        }),
      });
      
      if (!res.ok) throw new Error("Stream failed");
      
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
            if (p.token) { 
              full += p.token; 
              const c = full.replace(/\[System:[^\]]*\]/g, "").trim(); 
              setMessages(msgs => msgs.map(m => m.id === sid ? { ...m, text: c } : m)); 
            }
            if (p.done) {
              if (settings.soundEnabled) playDone();
              if (settings.ttsEnabled) { setSpeakingId(sid); speakText(full, () => setSpeakingId(null)); }
              if (!isTempChat && p.new_memory && p.new_memory.length > 0) {
                setMemory(prev => {
                  const merged = [...prev];
                  for (const item of p.new_memory) {
                    if (item && !merged.includes(item)) merged.push(item);
                  }
                  return merged;
                });
              }
            }
          } catch { }
        }
      }
    } catch (e) {
      console.error("Send error:", e);
      setMessages(p => [...p, { id: makeId(), role: "zoro", text: "can't reach the backend — make sure it's running.", timestamp: new Date() }]);
    }
    setLoading(false); 
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const isEmpty = messages.length === 0 && !loading;
  const canSend = (input.trim().length > 0 || !!pendingImg || !!pendingDoc) && !loading;
  const pinnedCount = messages.filter(m => m.pinned).length;

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
              initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}>
              <Sidebar chats={chats} activeChatId={activeChatId}
                onLoad={loadChat} onDelete={delChat} onNew={newChat} onClose={() => setSidebarOpen(false)} />
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
            {/* Mode toggle */}
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
            <motion.div className="panel-wrap" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <MemPanel memory={memory} onAdd={s => setMemory(p => [...p, s])}
                onDel={i => setMemory(p => p.filter((_, j) => j !== i))} onClose={() => setShowMem(false)} />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showProfile && (
            <motion.div className="panel-wrap prof-panel-wrap" initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ duration: 0.18 }}>
              <ProfileDropdown
                user={user}
                settings={settings}
                onChange={s => { setSettings(s); if (!s.ttsEnabled) { stopSpeaking(); setSpeakingId(null); } }}
                onOpenMemory={() => setShowMem(true)}
                onClose={() => setShowProfile(false)}
                onSignOut={signOut}
                isTempChat={isTempChat}
                onToggleTemp={() => { setIsTempChat(t => !t); setMessages([]); setActiveChatId(null); }}
                onNewChat={newChat}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showSettings && (
            <motion.div className="panel-wrap prof-panel-wrap" initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ duration: 0.18 }}>
              <SettingsDropdown settings={settings} onChange={s => { setSettings(s); if (!s.ttsEnabled) { stopSpeaking(); setSpeakingId(null); } }} onClose={() => setShowSettings(false)} />
            </motion.div>
          )}
        </AnimatePresence>


        {/* Body */}
        <main className="body">
          <AnimatePresence mode="wait">
            {mode === "voice" ? (
              <motion.div key="voice" className="voice-wrap"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                <VoiceMode memory={memory} settings={settings} />
              </motion.div>
            ) : isEmpty ? (
              <motion.div key="empty" className="empty-wrap"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                <h1 className="empty-title">Where should we begin?</h1>

                {/* Centered input bar */}
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
                <div className="empty-inp-box">
                  <button className="inp-ico" onPointerDown={e => { e.preventDefault(); docFileRef.current?.click(); }} disabled={loading} title="Document">{Ico.clip}</button>
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
                </div>
                <p className="empty-hint">{mobile ? "Tap send • mic for voice" : "Enter to send • Shift+Enter for new line"}</p>
              </motion.div>
            ) : (
              <motion.div key="chat" className="chat-scroll"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
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

        {/* Footer input — only when chatting */}
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
              <button className="inp-ico" onPointerDown={e => { e.preventDefault(); docFileRef.current?.click(); }} disabled={loading} title="Document">
                {Ico.clip}
              </button>
              <button className="inp-ico" onPointerDown={e => { e.preventDefault(); cameraRef.current?.click(); }} disabled={loading} title="Camera">
                {Ico.camera}
              </button>
              <button className="inp-ico" onPointerDown={e => { e.preventDefault(); fileRef.current?.click(); }} disabled={loading} title="Image">
                {Ico.img}
              </button>
              <textarea ref={taRef} className="inp-ta" value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (!mobile && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={isListening ? "Listening…" : "Message ZORO…"}
                disabled={loading} rows={1} autoCapitalize="sentences" spellCheck />
              <button className={`inp-ico mic-ico${isListening ? " mic-live" : ""}`}
                onPointerDown={e => { e.preventDefault(); isListening ? stopListen() : startListen(); }}
                disabled={loading}>
                {Ico.mic(isListening)}
              </button>
              <button className="inp-send" onPointerDown={e => { e.preventDefault(); send(); }} disabled={!canSend}>
                {Ico.send}
              </button>
            </div>
            <p className="foot-hint">
              {mobile ? "Tap send • mic for voice" : "Enter to send • Shift+Enter for new line"}
            </p>
          </footer>
        )}

        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setPendingImg(r.result as string); setPendingDoc(null); }; r.readAsDataURL(f); e.target.value = ""; }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setPendingImg(r.result as string); setPendingDoc(null); }; r.readAsDataURL(f); e.target.value = ""; }} />
        <input ref={docFileRef} type="file" accept="*/*" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (!f) return; setPendingDoc({name: f.name, file: f}); setPendingImg(null); e.target.value = ""; }} />
      </div>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=Fira+Code:wght@400&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --cream: #faf7f2;
  --sand: #f0ebe2;
  --sand2: #e8e0d4;
  --stone: #d5cec4;
  --warm-gray: #9c9489;
  --brown: #6b6058;
  --dark: #2e2a25;
  --accent: #b07d5a;
  --accent-light: #f5ede4;
  --user-bg: #2e2a25;
  --user-fg: #faf7f2;
  --zoro-bg: #f0ebe2;
  --zoro-fg: #2e2a25;
  --font: 'Figtree', system-ui, sans-serif;
  --mono: 'Fira Code', monospace;
  --sb-w: 260px;
  --hdr-h: 52px;
  --radius: 18px;
  --radius-sm: 10px;
  --shadow: 0 2px 12px rgba(46,42,37,.07);
  --shadow-lg: 0 8px 32px rgba(46,42,37,.12);
}

body { font-family: var(--font); background: var(--cream); color: var(--dark); }

.root {
  height: 100dvh; display: flex; flex-direction: column; background: var(--cream);
  overflow: hidden; position: relative;
}

/* Overlay */
.overlay { position: fixed; inset: 0; background: rgba(46,42,37,.3); z-index: 40; }

/* Sidebar */
.sb-wrap { position: fixed; top: 0; left: 0; height: 100dvh; z-index: 50; }
.sb {
  width: var(--sb-w); height: 100%; background: #fff;
  border-right: 1px solid var(--sand2); display: flex; flex-direction: column;
  box-shadow: var(--shadow-lg);
}
.sb-top {
  padding: 16px 14px; border-bottom: 1px solid var(--sand); display: flex;
  align-items: center; justify-content: space-between;
}
.sb-brand { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 14px; color: var(--dark); }
.sb-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.sb-new {
  display: flex; align-items: center; gap: 7px; margin: 10px 10px 4px;
  padding: 9px 13px; border-radius: 10px; border: 1px solid var(--sand2);
  background: var(--cream); color: var(--brown); font-family: var(--font);
  font-size: 13px; font-weight: 500; cursor: pointer; transition: all .12s;
}
.sb-new:hover { background: var(--sand); }
.sb-list { flex: 1; overflow-y: auto; padding: 4px 8px 16px; }
.sb-list::-webkit-scrollbar { width: 3px; }
.sb-list::-webkit-scrollbar-thumb { background: var(--sand2); border-radius: 3px; }
.sb-gl { font-size: 10.5px; font-weight: 600; color: var(--warm-gray); text-transform: uppercase; letter-spacing: .06em; padding: 10px 6px 4px; }
.sb-empty { font-size: 12.5px; color: var(--warm-gray); text-align: center; padding: 28px 12px; line-height: 1.6; }
.sb-item {
  display: flex; align-items: center; gap: 7px; padding: 8px 8px 8px 10px;
  border-radius: 9px; cursor: pointer; font-size: 12.5px; color: var(--dark);
  border: 1px solid transparent; margin-bottom: 1px; transition: background .1s;
}
.sb-item:hover { background: var(--cream); }
.sb-active { background: var(--sand); border-color: var(--sand2); }
.sb-i-ico { color: var(--warm-gray); flex-shrink: 0; }
.sb-i-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3; }
.sb-del {
  width: 22px; height: 22px; border: none; background: transparent;
  color: var(--warm-gray); cursor: pointer; border-radius: 6px; display: none;
  align-items: center; justify-content: center; padding: 0; transition: all .1s;
}
.sb-item:hover .sb-del { display: flex; }
.sb-del:hover { background: var(--sand2); color: var(--dark); }

/* Header */
.hdr {
  flex-shrink: 0; height: var(--hdr-h); display: flex; align-items: center;
  justify-content: space-between; padding: 0 14px; background: #fff;
  border-bottom: 1px solid var(--sand); position: relative; z-index: 10;
}
.hdr-l, .hdr-r { display: flex; align-items: center; gap: 6px; }
.logo { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14.5px; color: var(--dark); letter-spacing: -.01em; }
.logo-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
.logo-name {}

/* Icon buttons */
.ib {
  width: 32px; height: 32px; border-radius: 9px; border: none; background: transparent;
  color: var(--warm-gray); cursor: pointer; display: flex; align-items: center;
  justify-content: center; transition: background .12s, color .12s;
  -webkit-tap-highlight-color: transparent; flex-shrink: 0;
}
.ib:hover { background: var(--sand); color: var(--dark); }
.ib-on { background: var(--accent-light); color: var(--accent); }
.ib-on:hover { background: var(--accent-light); color: var(--accent); }

/* Mode toggle */
.mode-tog {
  display: flex; align-items: center; background: var(--sand); border-radius: 10px; padding: 3px; gap: 2px;
}
.mode-btn {
  display: flex; align-items: center; gap: 5px; padding: 5px 11px;
  border-radius: 8px; border: none; background: transparent; color: var(--warm-gray);
  font-family: var(--font); font-size: 12.5px; font-weight: 500; cursor: pointer;
  transition: all .15s; -webkit-tap-highlight-color: transparent;
}
.mode-on { background: #fff; color: var(--dark); box-shadow: 0 1px 4px rgba(46,42,37,.1); }
.hdr-new {
  width: 32px; height: 32px; border-radius: 9px; border: none;
  background: var(--accent); color: #fff; cursor: pointer; display: flex;
  align-items: center; justify-content: center; transition: opacity .12s;
}
.hdr-new:hover { opacity: .85; }

/* Panels */
.panel-wrap { position: absolute; top: calc(var(--hdr-h) + 8px); right: 14px; z-index: 30; }
.panel {
  width: 292px; background: #fff; border: 1px solid var(--sand2);
  border-radius: 16px; box-shadow: var(--shadow-lg); overflow: hidden;
}
.set-panel { width: 306px; }
.panel-hd {
  display: flex; align-items: center; justify-content: space-between;
  padding: 13px 15px; border-bottom: 1px solid var(--sand);
}
.panel-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--dark); }
.panel-hint { font-size: 12px; color: var(--warm-gray); padding: 8px 15px 4px; line-height: 1.5; }
.mem-list { max-height: 160px; overflow-y: auto; padding: 6px 10px; display: flex; flex-direction: column; gap: 4px; }
.mem-empty { font-size: 12px; color: var(--warm-gray); text-align: center; padding: 14px 0; }
.mem-item {
  display: flex; align-items: center; gap: 7px; padding: 7px 9px;
  background: var(--cream); border-radius: 8px; font-size: 12.5px; color: var(--dark);
}
.mem-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mem-del {
  width: 16px; height: 16px; border: none; background: transparent; color: var(--warm-gray);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  padding: 0; border-radius: 4px;
}
.mem-del:hover { background: var(--sand); }
.panel-inp-row { display: flex; gap: 7px; padding: 10px 10px 12px; border-top: 1px solid var(--sand); }
.panel-inp {
  flex: 1; border: 1px solid var(--sand2); border-radius: 9px; background: var(--cream);
  color: var(--dark); font-family: var(--font); font-size: 12.5px; padding: 7px 10px; outline: none;
  transition: border-color .12s;
}
.panel-inp:focus { border-color: var(--accent); }
.panel-add {
  padding: 7px 13px; border-radius: 9px; border: none; background: var(--accent); color: #fff;
  font-family: var(--font); font-size: 12.5px; font-weight: 500; cursor: pointer; transition: opacity .1s;
}
.panel-add:hover { opacity: .88; }
.set-list { padding: 4px 0 6px; }
.set-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 11px 15px; cursor: pointer; border-bottom: 1px solid var(--sand);
}
.set-row:last-child { border-bottom: none; }
.set-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.set-label { font-size: 13px; font-weight: 500; color: var(--dark); }
.set-desc { font-size: 11.5px; color: var(--warm-gray); line-height: 1.4; }
.tog { width: 38px; height: 22px; border-radius: 11px; background: var(--sand2); position: relative; cursor: pointer; transition: background .2s; flex-shrink: 0; }
.tog-on { background: var(--accent); }
.tog-thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.tog-on .tog-thumb { transform: translateX(16px); }

/* Body */
.body { flex: 1; overflow: hidden; position: relative; }

/* Empty state */
.empty-wrap {
  height: 100%; display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 24px 20px; gap: 18px; overflow-y: auto;
}
.empty-title { font-size: 26px; font-weight: 600; color: var(--dark); letter-spacing: -.03em; text-align: center; }
.empty-inp-box {
  width: 100%; max-width: 620px; display: flex; align-items: flex-end; gap: 6px;
  background: #fff; border: 1.5px solid var(--sand2); border-radius: 20px;
  padding: 10px 10px 10px 14px; box-shadow: var(--shadow-lg);
  transition: border-color .15s, box-shadow .15s;
}
.empty-inp-box:focus-within {
  border-color: var(--stone); box-shadow: 0 8px 40px rgba(46,42,37,.13);
}
.empty-hint { font-size: 11.5px; color: var(--stone); text-align: center; }

/* Temp pill */
.temp-pill {
  font-size: 10.5px; font-weight: 600; padding: 3px 9px; border-radius: 20px;
  background: rgba(176,125,90,.15); color: var(--accent); border: 1px solid rgba(176,125,90,.3);
  letter-spacing: .04em; text-transform: uppercase; font-family: var(--font);
}
.temp-row { border-bottom: none !important; }

/* Chat scroll */
.chat-scroll { height: 100%; overflow-y: auto; overscroll-behavior: contain; }
.chat-scroll::-webkit-scrollbar { width: 4px; }
.chat-scroll::-webkit-scrollbar-thumb { background: var(--sand2); border-radius: 4px; }
.chat-inner { max-width: 720px; margin: 0 auto; padding: 20px 18px 10px; display: flex; flex-direction: column; gap: 4px; }

/* Bubbles */
.bubble-row { display: flex; gap: 10px; padding: 5px 0; align-items: flex-start; }
.z-row {}
.u-row { flex-direction: row-reverse; }
.pinned .bubble { outline: 2px solid var(--accent) !important; outline-offset: 1px; }
.avatar {
  width: 28px; height: 28px; border-radius: 9px; display: flex; align-items: center;
  justify-content: center; font-size: 11.5px; font-weight: 600; flex-shrink: 0; margin-top: 2px;
}
.z-av { background: var(--accent-light); color: var(--accent); }
.u-av { background: var(--user-bg); color: var(--user-fg); }
.bwrap { display: flex; flex-direction: column; gap: 3px; max-width: min(74%, 540px); }
.u-wrap { align-items: flex-end; }
.pin-tag { font-size: 10.5px; color: var(--accent); font-weight: 500; padding-left: 2px; }
.bubble { padding: 10px 14px; border-radius: var(--radius); font-size: 14px; line-height: 1.65; word-break: break-word; }
.z-bubble { background: var(--zoro-bg); color: var(--zoro-fg); border-bottom-left-radius: 5px; }
.u-bubble { background: var(--user-bg); color: var(--user-fg); border-bottom-right-radius: 5px; }
.b-img { display: block; max-width: 100%; max-height: 260px; border-radius: 10px; margin-bottom: 7px; object-fit: contain; }
.b-doc-card { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: rgba(0,0,0,0.05); border-radius: 8px; text-decoration: none; color: inherit; margin-bottom: 6px; border: 1px solid rgba(0,0,0,0.05); transition: background 0.15s; }
.b-doc-card:hover { background: rgba(0,0,0,0.08); }
.b-doc-ico { display: flex; align-items: center; justify-content: center; opacity: 0.7; }
.b-doc-name { font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
.dark .b-doc-card { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.05); }
.dark .b-doc-card:hover { background: rgba(255,255,255,0.08); }
.z-code { background: rgba(0,0,0,.06); border-radius: 9px; padding: 10px 12px; font-family: var(--mono); font-size: 12.5px; overflow-x: auto; margin: 6px 0; }
.z-ic { font-family: var(--mono); font-size: 12.5px; background: rgba(0,0,0,.07); border-radius: 4px; padding: 1px 5px; }
.bmeta { display: flex; align-items: center; gap: 3px; opacity: 0; transition: opacity .15s; padding: 0 1px; }
.bubble-row:hover .bmeta { opacity: 1; }
.btime { font-size: 10.5px; color: var(--warm-gray); }
.bact {
  width: 20px; height: 20px; border-radius: 5px; border: none; background: transparent;
  color: var(--warm-gray); cursor: pointer; display: flex; align-items: center; justify-content: center;
  padding: 0; transition: background .1s;
}
.bact:hover { background: var(--sand2); }
.bact-on { color: var(--accent); }

/* Typing indicator */
.typing { display: flex; gap: 4px; align-items: center; padding: 2px 0; height: 20px; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--warm-gray); animation: bounce .9s ease-in-out infinite; }
.typing span:nth-child(2) { animation-delay: .15s; }
.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }

/* Input footer */
.foot { flex-shrink: 0; padding: 10px 18px 14px; background: #fff; border-top: 1px solid var(--sand); }
.img-pre-wrap { max-width: 684px; margin: 0 auto 8px; }
.img-pre { position: relative; display: inline-block; }
.img-pre img { height: 70px; max-width: 110px; border-radius: 9px; object-fit: cover; border: 1px solid var(--sand2); }
.doc-pre { position: relative; display: inline-flex; align-items: center; padding: 12px 18px; border-radius: 9px; border: 1px solid var(--sand2); background: var(--sand); font-size: 13px; font-family: var(--font); color: var(--dark); max-width: 100%; }
.doc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; font-weight: 500; }
.img-rm { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; background: var(--dark); color: #fff; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.inp-box {
  max-width: 684px; margin: 0 auto; display: flex; align-items: flex-end; gap: 6px;
  background: var(--cream); border: 1.5px solid var(--sand2); border-radius: 16px;
  padding: 8px 8px 8px 10px; transition: border-color .15s;
}
.inp-box:focus-within { border-color: var(--stone); }
.inp-ta {
  flex: 1; border: none; outline: none; background: transparent; font-family: var(--font);
  font-size: 14px; color: var(--dark); line-height: 1.55; resize: none; min-height: 22px;
  max-height: 150px; overflow-y: auto; padding: 1px 0;
}
.inp-ta::placeholder { color: var(--warm-gray); }
.inp-ta::-webkit-scrollbar { width: 0; }
.inp-ico {
  width: 34px; height: 34px; border-radius: 10px; border: none; background: transparent;
  color: var(--warm-gray); cursor: pointer; display: flex; align-items: center;
  justify-content: center; flex-shrink: 0; align-self: flex-end;
  transition: background .12s, color .12s; -webkit-tap-highlight-color: transparent;
}
.inp-ico:hover { background: var(--sand); color: var(--dark); }
.inp-ico:disabled { opacity: .35; cursor: not-allowed; }
.mic-ico {}
.mic-live { color: #c0392b; background: rgba(192,57,43,.1); animation: mic-pulse 1.1s ease-in-out infinite; }
@keyframes mic-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(192,57,43,.25); } 50% { box-shadow: 0 0 0 7px rgba(192,57,43,0); } }
.inp-send {
  width: 34px; height: 34px; border-radius: 10px; border: none; background: var(--accent);
  color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; align-self: flex-end; transition: opacity .12s, transform .1s;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent;
}
.inp-send:hover:not(:disabled) { opacity: .85; transform: scale(1.04); }
.inp-send:active:not(:disabled) { transform: scale(.93); }
.inp-send:disabled { opacity: .25; cursor: not-allowed; }
.foot-hint { text-align: center; font-size: 11.5px; color: var(--stone); margin-top: 7px; max-width: 684px; margin-left: auto; margin-right: auto; }

/* Voice mode */
.voice-wrap { height: 100%; display: flex; align-items: center; justify-content: center; }
.voice-shell { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 24px 20px; width: 100%; max-width: 420px; }
.orb-area { position: relative; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center; }
.orb-ring { position: absolute; inset: 0; border-radius: 50%; background: rgba(176,125,90,.18); }
.orb {
  position: relative; z-index: 2; width: 110px; height: 110px; border-radius: 50%;
  border: 2px solid var(--sand2); background: #fff; color: var(--warm-gray);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: border-color .2s, background .2s, color .2s;
  -webkit-tap-highlight-color: transparent; box-shadow: var(--shadow);
}
.orb:disabled { opacity: .5; cursor: not-allowed; }
.orb-live { border-color: var(--accent); background: var(--accent-light); color: var(--accent); }
.orb-spin { width: 30px; height: 30px; border-radius: 50%; border: 2.5px solid var(--sand2); border-top-color: var(--accent); }
.orb-label { font-size: 13.5px; color: var(--warm-gray); letter-spacing: .01em; }
.voice-cards { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.vcard { background: #fff; border: 1px solid var(--sand2); border-radius: 14px; padding: 13px 15px; }
.vc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.vc-who { display: block; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--warm-gray); margin-bottom: 6px; }
.zvc-who { color: var(--accent); margin-bottom: 0; }
.vc-text { font-size: 15px; color: var(--dark); line-height: 1.55; }
.err-card { border-color: rgba(192,57,43,.3); }
.err-card .vc-text { color: #c0392b; }

/* Avatar in header */
.hdr-avatar {
  width: 30px; height: 30px; border-radius: 50%; overflow: hidden;
  background: var(--accent-light); color: var(--accent); font-size: 13px;
  font-weight: 600; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; border: 1.5px solid var(--sand2); cursor: pointer;
  transition: box-shadow .15s, border-color .15s; padding: 0;
}
.hdr-avatar:hover { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }
.hdr-av-open { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }
.hdr-av-img { width: 100%; height: 100%; object-fit: cover; }

/* Profile dropdown */
.prof-panel-wrap { right: 10px; }
.prof-drop {
  width: 300px; background: #fff; border: 1px solid var(--sand2);
  border-radius: 18px; box-shadow: var(--shadow-lg); overflow: hidden;
}
.prof-user {
  display: flex; align-items: center; gap: 11px; padding: 14px 14px 14px 15px;
}
.prof-av {
  width: 40px; height: 40px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
  background: var(--accent-light); color: var(--accent); font-size: 16px;
  font-weight: 700; display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--sand2);
}
.prof-av-img { width: 100%; height: 100%; object-fit: cover; }
.prof-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.prof-name { font-size: 13.5px; font-weight: 600; color: var(--dark); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prof-email { font-size: 11.5px; color: var(--warm-gray); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prof-divider { height: 1px; background: var(--sand); margin: 0; }
.prof-section-label { font-size: 10.5px; font-weight: 600; color: var(--warm-gray); text-transform: uppercase; letter-spacing: .07em; padding: 8px 15px 2px; }
.set-icon { margin-right: 6px; font-size: 13px; }

/* Memory / action row */
.prof-action {
  width: 100%; display: flex; align-items: center; gap: 11px; padding: 10px 14px 10px 15px;
  border: none; background: transparent; cursor: pointer; text-align: left;
  transition: background .12s; -webkit-tap-highlight-color: transparent;
}
.prof-action:hover { background: var(--cream); }
.prof-action-ico { color: var(--warm-gray); display: flex; align-items: center; flex-shrink: 0; }
.prof-action-info { flex: 1; display: flex; flex-direction: column; gap: 1px; }
.prof-action-label { font-size: 13px; font-weight: 500; color: var(--dark); }
.prof-action-desc { font-size: 11.5px; color: var(--warm-gray); line-height: 1.4; }
.prof-action-arr { font-size: 18px; color: var(--stone); line-height: 1; }

/* Sign out */
.set-signout-wrap { padding: 10px 15px 14px; }
.set-signout {
  width: 100%; padding: 9px; border-radius: 10px; border: 1.5px solid rgba(192,57,43,.25);
  background: transparent; color: #c0392b; font-family: var(--font); font-size: 13px;
  font-weight: 500; cursor: pointer; transition: all .12s;
}
.set-signout:hover { background: rgba(192,57,43,.06); }

@media (max-width: 480px) {
  .chat-inner { padding: 12px 12px 6px; }
  .bubble { font-size: 14.5px; }
  .empty-title { font-size: 19px; }
  .foot-hint { display: none; }
  .panel-wrap { right: 8px; left: 8px; }
  .panel, .set-panel { width: 100%; }
  .orb { width: 96px; height: 96px; }
  .orb-area { width: 100px; height: 100px; }
}

/* ─── Dark Mode ────────────────────────────────────────────────────────────── */
.dark {
  --cream: #1a1816;
  --sand: #252220;
  --sand2: #332f2b;
  --stone: #4a4540;
  --warm-gray: #8a837b;
  --brown: #b0a89e;
  --dark: #ede8e2;
  --accent: #c9956e;
  --accent-light: #2c2420;
  --user-bg: #c9956e;
  --user-fg: #1a1816;
  --zoro-bg: #252220;
  --zoro-fg: #ede8e2;
  --shadow: 0 2px 12px rgba(0,0,0,.2);
  --shadow-lg: 0 8px 32px rgba(0,0,0,.3);
}
.dark body, .dark .root { background: var(--cream); color: var(--dark); }
.dark .hdr { background: #1e1c19; border-bottom-color: var(--sand2); }
.dark .sb { background: #1e1c19; border-right-color: var(--sand2); }
.dark .inp-box { background: var(--sand); border-color: var(--sand2); }
.dark .foot { background: #1e1c19; border-top-color: var(--sand2); }
.dark .panel { background: #1e1c19; border-color: var(--sand2); }
.dark .prof-drop { background: #1e1c19; border-color: var(--sand2); }
.dark .mode-tog { background: var(--sand); }
.dark .mode-on { background: var(--sand2); color: var(--dark); box-shadow: none; }
.dark .chip { background: var(--sand); border-color: var(--sand2); color: var(--brown); }
.dark .chip:hover { background: var(--sand2); color: var(--dark); }
.dark .vcard { background: var(--sand); border-color: var(--sand2); }
.dark .orb { background: var(--sand); border-color: var(--sand2); }
.dark .z-code { background: rgba(255,255,255,.06); }
.dark .z-ic { background: rgba(255,255,255,.08); }
.dark .mem-item { background: var(--sand); }
.dark .empty-inp-box { background: var(--sand); border-color: var(--sand2); }
.dark .login-root { background: var(--cream); }
`;