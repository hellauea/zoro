import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "./firebase";

// ─── Types (matching Index.tsx) ───────────────────────────────────────────────

type Message = {
  id: string;
  role: "user" | "zoro";
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

// ─── Chats ────────────────────────────────────────────────────────────────────

export async function saveChat(userId: string, chat: Chat) {
  try {
    const ref = doc(db, "users", userId, "chats", chat.id);
    await setDoc(ref, {
      title: chat.title,
      createdAt: chat.createdAt.toISOString(),
      messages: chat.messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        image: m.image || null,
        document: m.document || null,
        timestamp: m.timestamp.toISOString(),
        pinned: m.pinned || false,
      })),
      updatedAt: serverTimestamp(),
    });
  } catch { /* silently ignore offline / permission errors */ }
}

export async function loadChats(userId: string): Promise<Chat[]> {
  try {
    const ref = collection(db, "users", userId, "chats");
    const q = query(ref, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: data.title || "Untitled",
        createdAt: new Date(data.createdAt),
        messages: (data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          image: m.image || undefined,
          document: m.document || undefined,
          timestamp: new Date(m.timestamp),
          pinned: m.pinned || false,
        })),
      };
    });
  } catch { return []; }
}

export async function deleteChat(userId: string, chatId: string) {
  try {
    const ref = doc(db, "users", userId, "chats", chatId);
    await deleteDoc(ref);
  } catch { /* silently ignore */ }
}

export async function uploadDocument(userId: string, file: File): Promise<string> {
  const fileRef = ref(storage, `users/${userId}/documents/${Date.now()}_${file.name}`);
  await uploadBytes(fileRef, file);
  return await getDownloadURL(fileRef);
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export async function saveMemory(userId: string, memory: string[]) {
  try {
    const ref = doc(db, "users", userId, "data", "memory");
    await setDoc(ref, { items: memory });
  } catch { /* silently ignore */ }
}

export async function loadMemory(userId: string): Promise<string[]> {
  try {
    const ref = doc(db, "users", userId, "data", "memory");
    const snap = await getDoc(ref);
    if (!snap.exists()) return [];
    return snap.data().items || [];
  } catch { return []; }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Settings = {
  ttsEnabled: false,
  soundEnabled: true,
  storeHistory: true,
  darkMode: true,
};

export async function saveUserSettings(userId: string, settings: Settings) {
  try {
    const ref = doc(db, "users", userId, "data", "settings");
    await setDoc(ref, settings);
  } catch { /* silently ignore */ }
}

export async function loadUserSettings(userId: string): Promise<Settings> {
  try {
    const ref = doc(db, "users", userId, "data", "settings");
    const snap = await getDoc(ref);
    if (!snap.exists()) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...snap.data() } as Settings;
  } catch { return DEFAULT_SETTINGS; }
}
