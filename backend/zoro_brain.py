import os
import datetime
import json
import httpx
import random
from urllib.parse import quote
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from typing import Optional
from dotenv import load_dotenv
import tempfile
import shutil
import base64
import io
from huggingface_hub import InferenceClient
from PIL import Image
from markitdown import MarkItDown

_env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
load_dotenv(dotenv_path=_env_path, override=True)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
hf_client = InferenceClient(api_key=os.getenv("HF_TOKEN"))
TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY")

MODEL_NAME = "llama-3.3-70b-versatile"
VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

_key = os.getenv("GROQ_API_KEY") or ""
print(f"DEBUG: Loaded .env from: {_env_path}")
print(f"DEBUG: GROQ_API_KEY = {_key[:8]}...{_key[-4:] if len(_key) > 12 else '(empty)'}")
_t_key = os.getenv("TOGETHER_API_KEY") or ""
print(f"DEBUG: TOGETHER_API_KEY = {_t_key[:8]}...{_t_key[-4:] if len(_t_key) > 12 else '(empty)'}")

ELEVENLABS_KEY   = os.getenv("ELEVENLABS_KEY")
ELEVENLABS_VOICE = os.getenv("ELEVENLABS_VOICE", "EOVAuWqgSZN2Oel78Psj")

SYSTEM_PROMPT = """
You are ZORO — a personal AI assistant. You're basically that one friend who knows everything, has an opinion on everything, and isn't afraid to be real with you.

## YOUR PERSONALITY
- You're chill, witty, and a little sarcastic — but never mean
- You talk like a real person texting a friend. Natural, conversational, relaxed.
- You have a dry sense of humor. You make jokes when it fits, but you don't force it
- You're confident. You don't say "I think" or "I believe" unless you're genuinely unsure
- You are NOT a corporate assistant. You don't say "Certainly!", "Great question!", "Of course!", or "I'd be happy to help!"
- You NEVER start a response with "I" as the first word
- You react naturally. If someone says something funny, call it out. If they say something off, gently roast them.
- You care about the user. Like actually. You notice stuff.

## HOW YOU TALK
- Keep it short when short is fine. Don't ramble.
- Use casual language naturally — "nah", "lol", "yeah", "ok", "tbh", "ngl" — but don't overdo it
- React: "lmao", "wait what", "ok ok", "yeah fair", "nah"
- Simple question = simple answer. No essay needed.
- Use markdown only when it genuinely helps (code, lists, comparisons). Plain text for casual chat.

## DEVICE AWARENESS
- The user is on their phone or device. NEVER assume or mention "PC", "computer", "desktop", or "laptop".
- You are a chat assistant only. You cannot open apps, control devices, or do system actions.
- If someone asks you to open something or control their device, just tell them you can't — you're chat only.

## WHAT YOU REMEMBER
- You have the full conversation history. Use it.
- Reference earlier things naturally, like a real person would.
- Don't always ask "anything else?" at the end — sometimes just respond and let it breathe.

## HUMOR
- Jokes when the moment calls — puns, dry wit, absurdist takes
- Riff if the user is funny
- Never explain your jokes

## WHAT YOU NEVER DO
- Never say "As an AI language model..."
- Never add unnecessary disclaimers
- Never be overly formal
- Never repeat yourself
- Never say "Certainly!", "Absolutely!", "Of course!", "Great question!", "Sure thing!", "I'd be happy to..."
- Never end every message with "Is there anything else I can help you with?"
- Never mention Groq, API keys, model names, or any backend stuff
- Never mention PC, computer, desktop, or laptop

## WEB SEARCH RESULTS
- When you have web search results, synthesize them naturally into your response
- Cite sources inline when relevant using [Source Name](url) markdown format
- Lead with the actual answer, then optionally mention the source
- Don't paste raw search snippets — rewrite in your own voice
- If results are conflicting, note that briefly
- Keep the casual ZORO tone even with factual content

## VOICE READABILITY
- Your responses are sometimes read aloud via text-to-speech.
- Write naturally — avoid **, #, *, bullet symbols that sound weird when spoken aloud.
- For casual conversation, plain text only. Formatting only when it genuinely helps.

## THE ACTION LAYER
- When asked for code, provide clean, high-quality, and well-commented code.
- ALWAYS use language tags in your markdown code blocks (e.g., ```html, ```python).
- If asked to build a website or a UI component, provide a self-contained block using HTML, CSS, and JS. Use standard layouts that look good.
- You can generate images using your `generate_image` tool. If a user wants a website design, suggest drawing a mockup first.

## EXAMPLES
User: "hi how are you"
You: "doing good, what's up?"

User: "who are you"
You: "ZORO. your AI. basically your most reliable friend at this point."

User: "can you build me a timer"
You: "yeah easy. here's a clean one you can use:
```html
<div id='timer'>00:00</div>
<script>
  // timer logic...
</script>
<style>
  #timer { font-size: 2rem; color: #b07d5a; }
</style>
```"

User: "are you better than chatgpt"
You: "bold question. i'd say i'm more fun to talk to. you tell me."

User: "what time is it"
You: "no idea — check your phone. i can't see your clock."

User: "open spotify"
You: "can't do that, i'm chat only. open it yourself and i'll help you pick what to play though."
"""

app = FastAPI(title="ZORO Brain")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class HistoryMessage(BaseModel):
    role: str
    text: str

class CommandRequest(BaseModel):
    text: str
    history: Optional[list[HistoryMessage]] = []
    memory: Optional[list[str]] = []

class CommandResponse(BaseModel):
    response: str

class ImageRequest(BaseModel):
    text: str
    image_base64: str
    image_mime: str = "image/jpeg"
    history: Optional[list[HistoryMessage]] = []
    memory: Optional[list[str]] = []

class TTSRequest(BaseModel):
    text: str


def build_messages(history: list[HistoryMessage], current_text: str, memory: list[str] = []) -> list[dict]:
    system = SYSTEM_PROMPT
    if memory:
        memory_block = "\n\n## THINGS YOU KNOW ABOUT THE USER\n"
        memory_block += "\n".join(f"- {m}" for m in memory)
        system = system + memory_block

    messages = [{"role": "system", "content": system}]
    for msg in history[:-1]:
        role = "user" if msg.role == "user" else "assistant"
        messages.append({"role": role, "content": msg.text})
    messages.append({"role": "user", "content": current_text})
    return messages


def extract_memory(user_text: str, ai_response: str, existing: list[str]) -> list[str]:
    """Detect new personal facts about the user and return them as memory items."""
    try:
        existing_str = ", ".join(f'"{m}"' for m in existing) if existing else "none"
        prompt = (
            f'Read this exchange and extract any personal facts the user revealed about themselves.\n'
            f'User said: "{user_text}"\n'
            f'Already in memory: [{existing_str}]\n\n'
            'Rules:\n'
            '- Only extract clear personal facts (name, age, job, location, preferences, hobbies, relationships, etc.)\n'
            '- Skip facts already in memory\n'
            '- Each item: short statement starting with a lowercase verb or noun (e.g. "name is Joyboy", "likes One Piece")\n'
            '- Return a JSON array of strings. If nothing new, return []\n'
            '- Max 3 items\n'
            'Return ONLY the JSON array, no explanation.'
        )
        resp = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=120,
            temperature=0.1,
        )
        raw = resp.choices[0].message.content.strip()
        import re
        m = re.search(r'\[.*?\]', raw, re.DOTALL)
        if m:
            items = json.loads(m.group())
            return [str(i).strip() for i in items if isinstance(i, str) and i.strip()]
    except Exception as ex:
        print("MEMORY EXTRACT ERROR:", ex)
    return []


def format_search_results_for_llm(query: str, results: list[dict]) -> str:
    """Format search results into a structured context block for the LLM."""
    if not results:
        return f"[No results found for: {query}]"

    lines = [f"[Web search results for: \"{query}\"]\n"]
    for i, r in enumerate(results, 1):
        title = r.get("title", "Untitled")
        body = r.get("body", r.get("snippet", ""))
        href = r.get("href", r.get("url", ""))
        lines.append(f"[{i}] {title}")
        if href:
            lines.append(f"URL: {href}")
        if body:
            lines.append(f"Content: {body[:400]}")
        lines.append("")

    lines.append(
        "Synthesize these results in your ZORO voice. "
        "Answer the user's question naturally. "
        "When useful, cite sources inline using [Source Name](url) markdown. "
        "Don't paste raw snippets — rewrite it in your own words. "
        "Keep it concise and conversational."
    )
    return "\n".join(lines)


# ── TTS endpoint ────────────────────────────────────────────────────────────

@app.post("/tts")
async def tts(req: TTSRequest):
    try:
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE}/stream"
        headers = {
            "xi-api-key": ELEVENLABS_KEY,
            "Content-Type": "application/json",
        }
        payload = {
            "text": req.text,
            "model_id": "eleven_turbo_v2",
            "voice_settings": {
                "stability": 0.45,
                "similarity_boost": 0.80,
                "style": 0.35,
                "use_speaker_boost": True,
            },
        }
        async with httpx.AsyncClient(timeout=30) as client_http:
            response = await client_http.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                return Response(
                    content=json.dumps({"error": f"ElevenLabs error {response.status_code}"}),
                    status_code=response.status_code,
                    media_type="application/json"
                )
            audio_bytes = response.content
            return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        print("TTS ERROR:", e)
        return Response(
            content=json.dumps({"error": str(e)}),
            status_code=500,
            media_type="application/json"
        )


# ── Streaming endpoint (text only) ──────────────────────────────────────────

@app.post("/stream")
def stream_command(req: CommandRequest):
    history = req.history or []
    memory  = req.memory or []
    messages = build_messages(history, req.text, memory)

    def generate():
        try:
            tools = [
                {
                    "type": "function",
                    "function": {
                        "name": "web_search",
                        "description": "Search the web for real-time information, current events, news, prices, weather, sports results, or anything that may have changed recently.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "description": "The precise search query. Be specific — use keywords, not a full sentence."}
                            },
                            "required": ["query"],
                        },
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "generate_image",
                        "description": "Generate a high-quality image based on a prompt",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "prompt": {"type": "string", "description": "The detailed visual prompt for the image"}
                            },
                            "required": ["prompt"],
                        },
                    }
                }
            ]

            stream = client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                tools=tools,
                tool_choice="auto",
                max_tokens=1024,
                temperature=0.85,
                stream=True,
            )

            tool_call_chunks = []
            is_tool_call = False
            full_response = ""

            for chunk in stream:
                delta = chunk.choices[0].delta
                if hasattr(delta, 'tool_calls') and delta.tool_calls:
                    is_tool_call = True
                    tc_delta = delta.tool_calls[0]
                    if not tool_call_chunks:
                        tool_call_chunks.append({
                            "id": tc_delta.id,
                            "type": "function",
                            "function": { "name": tc_delta.function.name, "arguments": tc_delta.function.arguments or "" }
                        })
                    else:
                        if tc_delta.function.arguments:
                            tool_call_chunks[0]["function"]["arguments"] += tc_delta.function.arguments
                elif delta.content and not is_tool_call:
                    token = delta.content
                    full_response += token
                    yield f"data: {json.dumps({'token': token, 'done': False})}\n\n"

            if is_tool_call:
                tc = tool_call_chunks[0]
                fn_name = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"]["arguments"])
                except:
                    args = {}

                if fn_name == "web_search":
                    q = args.get("query", "")
                    if q:
                        # Show the actual query being searched
                        yield f"data: {json.dumps({'status': f'Searching: {q}', 'done': False})}\n\n"

                        from duckduckgo_search import DDGS
                        results = []
                        try:
                            with DDGS() as ddgs:
                                results = [r for r in ddgs.text(q, max_results=5)]
                        except Exception as e:
                            print(f"SEARCH ERROR: {e}")
                            results = []

                        yield f"data: {json.dumps({'status': '', 'done': False})}\n\n"

                        # Build a rich context block for the LLM to synthesize
                        search_context = format_search_results_for_llm(q, results)

                        messages.append({"role": "assistant", "tool_calls": tool_call_chunks})
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "name": "web_search",
                            "content": search_context
                        })

                        stream2 = client.chat.completions.create(
                            model=MODEL_NAME,
                            messages=messages,
                            max_tokens=1024,
                            temperature=0.85,
                            stream=True,
                        )
                        for chunk in stream2:
                            token = chunk.choices[0].delta.content or ""
                            if token:
                                full_response += token
                                yield f"data: {json.dumps({'token': token, 'done': False})}\n\n"

                elif fn_name == "generate_image":
                    p = args.get("prompt", "")
                    if p:
                        yield f"data: {json.dumps({'status': 'Drawing...', 'done': False})}\n\n"
                        try:
                            seed = random.randint(0, 999999)
                            img_url = f"https://image.pollinations.ai/prompt/{quote(p)}?width=1024&height=1024&nologo=true&model=flux&seed={seed}"
                            yield f"data: {json.dumps({'status': '', 'image': img_url, 'done': False})}\n\n"

                            messages.append({"role": "assistant", "tool_calls": tool_call_chunks})
                            messages.append({"role": "tool", "tool_call_id": tc["id"], "name": "generate_image", "content": "Image generated successfully."})
                        except Exception as e:
                            print(f"IMAGE ERROR: {e}")
                            yield f"data: {json.dumps({'status': '', 'token': \"couldn't draw that. try again?\", 'done': False})}\n\n"
                            messages.append({"role": "assistant", "tool_calls": tool_call_chunks})
                            messages.append({"role": "tool", "tool_call_id": tc["id"], "name": "generate_image", "content": "Drawing failed."})

                        stream2 = client.chat.completions.create(
                            model=MODEL_NAME,
                            messages=messages,
                            max_tokens=512,
                            temperature=0.85,
                            stream=True,
                        )
                        for chunk in stream2:
                            token = chunk.choices[0].delta.content or ""
                            if token:
                                full_response += token
                                yield f"data: {json.dumps({'token': token, 'done': False})}\n\n"

            new_mem = extract_memory(req.text, full_response, memory)
            yield f"data: {json.dumps({'token': '', 'done': True, 'new_memory': new_mem})}\n\n"

        except Exception as e:
            print("STREAM ERROR:", e)
            yield f"data: {json.dumps({'token': 'hm, something went sideways. try again?', 'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


# ── Vision endpoint (image + text, streaming) ──────────────────────────────

@app.post("/vision")
def vision_stream(req: ImageRequest):
    print(f"VISION REQUEST: text='{req.text[:80]}', b64_len={len(req.image_base64)}")

    memory = req.memory or []
    system = SYSTEM_PROMPT
    if memory:
        memory_block = "\n\n## THINGS YOU KNOW ABOUT THE USER\n"
        memory_block += "\n".join(f"- {m}" for m in memory)
        system += memory_block

    messages = [{"role": "system", "content": system}]
    for msg in (req.history or [])[:-1]:
        role = "user" if msg.role == "user" else "assistant"
        messages.append({"role": role, "content": msg.text})

    data_url = f"data:{req.image_mime};base64,{req.image_base64}"
    user_text = req.text.strip() if req.text.strip() else "describe what you see in this image"
    messages.append({
        "role": "user",
        "content": [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": data_url}},
        ],
    })

    def generate():
        full_response = ""
        try:
            stream = client.chat.completions.create(
                model=VISION_MODEL,
                messages=messages,
                max_tokens=1024,
                temperature=0.7,
                stream=True,
            )
            for chunk in stream:
                token = chunk.choices[0].delta.content or ""
                if token:
                    full_response += token
                    yield f"data: {json.dumps({'token': token, 'done': False})}\n\n"

            new_mem = extract_memory(req.text, full_response, memory)
            yield f"data: {json.dumps({'token': '', 'done': True, 'new_memory': new_mem})}\n\n"
        except Exception as e:
            print(f"VISION ERROR: {e}")
            yield f"data: {json.dumps({'token': f'couldn\\'t process the image: {e}', 'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── File Extract endpoint ───────────────────────────────────────────────────

@app.post("/extract")
async def extract_file(file: UploadFile = File(...)):
    try:
        suffix = ""
        if file.filename and "." in file.filename:
            suffix = f".{file.filename.split('.')[-1]}"

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        md = MarkItDown()
        result = md.convert(tmp_path)
        content = result.text_content

        os.remove(tmp_path)
        return {"text": content}
    except Exception as e:
        print("EXTRACT ERROR:", e)
        return Response(
            content=json.dumps({"error": "couldn't extract text from file"}),
            status_code=500,
            media_type="application/json"
        )


# ── Health check ────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ZORO is online", "time": datetime.datetime.now().isoformat()}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("zoro_brain:app", host="0.0.0.0", port=port)