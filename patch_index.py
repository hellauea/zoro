import re

with open("t:/zoroapk/frontend/src/pages/Index.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update imports
content = content.replace(
    "  DEFAULT_SETTINGS,\n} from \"@/lib/firestore\";",
    "  DEFAULT_SETTINGS,\n  uploadDocument,\n} from \"@/lib/firestore\";"
)

# 2. Update Message type
content = content.replace(
    "  image?: string;\n  timestamp: Date;",
    "  image?: string;\n  document?: { name: string; url: string };\n  timestamp: Date;"
)

# 3. Add refresh icon to Ico
content = content.replace(
    "  menu: <svg",
    "  refresh: <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2\" strokeLinecap=\"round\" strokeLinejoin=\"round\"><path d=\"M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /><path d=\"M3 3v5h5\" /><path d=\"M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16\" /><path d=\"M16 21v-5h5\" /></svg>,\n  menu: <svg"
)

# 4. Update Bubble to receive onRegenerate and render document card + regenerate button
bubble_sig_old = "function Bubble({ msg, onPin, onSpeak, speaking, tts }: {\n  msg: Message; onPin: (id: string) => void;\n  onSpeak: (text: string, id: string) => void;\n  speaking: boolean; tts: boolean;\n}) {"
bubble_sig_new = "function Bubble({ msg, onPin, onSpeak, onRegenerate, speaking, tts, isLastZoro }: {\n  msg: Message; onPin: (id: string) => void;\n  onSpeak: (text: string, id: string) => void;\n  onRegenerate: (id: string) => void;\n  speaking: boolean; tts: boolean; isLastZoro: boolean;\n}) {"
content = content.replace(bubble_sig_old, bubble_sig_new)

# Inside Bubble, render document and regenerate button
bubble_img_old = "{msg.image && <img src={msg.image} alt=\"\" className=\"b-img\" />}"
bubble_img_new = """{msg.image && <img src={msg.image} alt="" className="b-img" />}
          {msg.document && (
            <a href={msg.document.url} target="_blank" rel="noopener noreferrer" className="b-doc-card">
              <span className="b-doc-ico">{Ico.clip}</span>
              <span className="b-doc-name">{msg.document.name}</span>
            </a>
          )}"""
content = content.replace(bubble_img_old, bubble_img_new)

# Modify renderMd to strip out [Attached Document: ...] cleanly from UI text
rendermd_old = "    .replace(/\\[System:[^\\]]*\\]/g, \"\").trim()"
rendermd_new = "    .replace(/\\[System:[^\\]]*\\]/g, \"\").replace(/\\[Attached Document: [^\\]]+\\](?: \\(failed to read\\))?\\n?/g, \"\").trim()"
content = content.replace(rendermd_old, rendermd_new)

# Regenerate button in bmeta
bmeta_old = "{isZ && tts && msg.text && ("
bmeta_new = """{isZ && isLastZoro && (
            <button className="bact" onClick={() => onRegenerate(msg.id)} title="Regenerate">{Ico.refresh}</button>
          )}
          {isZ && tts && msg.text && ("""
content = content.replace(bmeta_old, bmeta_new)

# 5. Extract Settings from ProfileDropdown
prof_old = """      {/* Settings toggles */}
      <div className="prof-section-label">Preferences</div>
      <div className="set-list">
        {settingRows.map(({ key, label, desc, icon }) => (
          <label key={key} className="set-row">
            <div className="set-info">
              <span className="set-label"><span className="set-icon">{icon}</span>{label}</span>
              <span className="set-desc">{desc}</span>
            </div>
            <div className={`tog${settings[key] ? " tog-on" : ""}`}
              onClick={() => onChange({ ...settings, [key]: !settings[key] })}>
              <div className="tog-thumb" />
            </div>
          </label>
        ))}
      </div>

      <div className="prof-divider" />"""
content = content.replace(prof_old, "")

# Create SettingsDropdown component
settings_dropdown = """
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
"""
content = content.replace("// ─── Main ─────────────────────────────────────────────────────────────────────", settings_dropdown + "\n// ─── Main ─────────────────────────────────────────────────────────────────────")

# 6. Index component changes
content = content.replace("const [showProfile, setShowProfile] = useState(false);", "const [showProfile, setShowProfile] = useState(false);\n  const [showSettings, setShowSettings] = useState(false);")

# Update click outside for settings/profile
click_outside_old = "if (sidebarOpen && sbRef.current && !sbRef.current.contains(e.target as Node)) setSidebarOpen(false);"
click_outside_new = """if (sidebarOpen && sbRef.current && !sbRef.current.contains(e.target as Node)) setSidebarOpen(false);
      // If clicking outside panels, close them. Simple implementation: any click closes them unless it's on a panel.
      const t = e.target as HTMLElement;
      if (!t.closest('.prof-panel-wrap') && !t.closest('.hdr-r')) {
        setShowProfile(false);
        setShowSettings(false);
      }"""
content = content.replace(click_outside_old, click_outside_new)

# Add regenerate function
regenerate_fn = """
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
           const lines = buf.split("\\n\\n"); buf = lines.pop() ?? "";
           for (const line of lines) {
             if (!line.startsWith("data: ")) continue;
             try {
               const p = JSON.parse(line.slice(6));
               if (p.token) { full += p.token; const c = full.replace(/\\[System:[^\\]]*\\]/g, "").trim(); setMessages(msgs => msgs.map(m => m.id === sid ? { ...m, text: c } : m)); }
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
"""
content = content.replace("const send = async (override?: string) => {", regenerate_fn + "\n  const send = async (override?: string) => {")

# Update send function to handle document uploading
send_old = """    const doc = pendingDoc;
    const userMsg: Message = { id: makeId(), role: "user", text: txt || (doc ? doc.name : ""), image: pendingImg ?? undefined, timestamp: new Date() };"""
send_new = """    const doc = pendingDoc;
    let docUrl = "";
    if (doc && uid) {
      try { docUrl = await uploadDocument(uid, doc.file); } catch { console.error("Upload failed"); }
    }
    const userMsg: Message = { id: makeId(), role: "user", text: txt || (doc ? doc.name : ""), image: pendingImg ?? undefined, document: docUrl ? { name: doc.name, url: docUrl } : undefined, timestamp: new Date() };"""
content = content.replace(send_old, send_new)

# Update Bubble rendering in list
bubble_map_old = """                    {messages.map(msg => (
                      <Bubble key={msg.id} msg={msg}
                        onPin={id => setMessages(p => p.map(m => m.id === id ? { ...m, pinned: !m.pinned } : m))}
                        onSpeak={handleSpeak}
                        speaking={speakingId === msg.id}
                        tts={settings.ttsEnabled} />
                    ))}"""
bubble_map_new = """                    {messages.map((msg, i, arr) => {
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
                    })}"""
content = content.replace(bubble_map_old, bubble_map_new)

# Update Header to include Settings Icon
hdr_av_old = """            {user && (
              <button
                className={`hdr-avatar${showProfile ? " hdr-av-open" : ""}`}
                title={user.displayName || user.email || ""}
                onClick={() => { setShowProfile(s => !s); setShowMem(false); }}
              >"""
hdr_av_new = """            {user && (
              <>
              <button className={`ib ${showSettings ? 'ib-on' : ''}`} onClick={() => { setShowSettings(s => !s); setShowProfile(false); setShowMem(false); }}>
                {Ico.settings}
              </button>
              <button
                className={`hdr-avatar${showProfile ? " hdr-av-open" : ""}`}
                title={user.displayName || user.email || ""}
                onClick={() => { setShowProfile(s => !s); setShowSettings(false); setShowMem(false); }}
              >"""
content = content.replace(hdr_av_old, hdr_av_new)
# Close fragment for hdr_r
content = content.replace("</span>}\n              </button>\n            )}", "</span>}\n              </button>\n              </>\n            )}")


# Add Settings panel rendering
prof_panel_code = """        <AnimatePresence>
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
        </AnimatePresence>"""
        
settings_panel_code = """
        <AnimatePresence>
          {showSettings && (
            <motion.div className="panel-wrap prof-panel-wrap" initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ duration: 0.18 }}>
              <SettingsDropdown settings={settings} onChange={s => { setSettings(s); if (!s.ttsEnabled) { stopSpeaking(); setSpeakingId(null); } }} onClose={() => setShowSettings(false)} />
            </motion.div>
          )}
        </AnimatePresence>
"""
content = content.replace(prof_panel_code, prof_panel_code + settings_panel_code)

# Add b-doc-card CSS
css_old = ".b-img { display: block; max-width: 100%; max-height: 260px; border-radius: 10px; margin-bottom: 7px; object-fit: contain; }"
css_new = """.b-img { display: block; max-width: 100%; max-height: 260px; border-radius: 10px; margin-bottom: 7px; object-fit: contain; }
.b-doc-card { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: rgba(0,0,0,0.05); border-radius: 8px; text-decoration: none; color: inherit; margin-bottom: 6px; border: 1px solid rgba(0,0,0,0.05); transition: background 0.15s; }
.b-doc-card:hover { background: rgba(0,0,0,0.08); }
.b-doc-ico { display: flex; align-items: center; justify-content: center; opacity: 0.7; }
.b-doc-name { font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
.dark .b-doc-card { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.05); }
.dark .b-doc-card:hover { background: rgba(255,255,255,0.08); }"""
content = content.replace(css_old, css_new)

with open("t:/zoroapk/frontend/src/pages/Index.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("Patch applied")
