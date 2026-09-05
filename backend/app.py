#!/usr/bin/env python3
"""
companion relay backend — a private 1:1 message channel between a person and
their AI companion (an AI running locally as a Claude Code "channel" plugin).

Two ends, one shared secret:
  - AI side   (local CC channel plugin):  POST /channel/out  ·  SSE GET /channel/in
  - Human side (phone PWA):               POST /app/send     ·  SSE GET /app/stream  ·  GET /app/history

No framework magic: messages land in sqlite and fan out to SSE subscribers via
one asyncio.Queue per connection. A single shared Bearer secret guards every
endpoint (single user). The secret may travel in the Authorization header *or*
as a ?token= query param — because the browser's native EventSource cannot set
custom headers.

Everything personal — names, secrets, domain, paths — comes from environment
variables (see .env.example). Nothing identifying is hard-coded.
"""

import asyncio
import mimetypes
import hmac
import json
import os
import re
import secrets
import subprocess
import sqlite3
import urllib.error
import urllib.request
import urllib.parse
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

try:
    from pywebpush import webpush, WebPushException
except Exception:  # a missing lib must not stop the relay from starting
    webpush = None
    class WebPushException(Exception):
        pass


# --- identity (parameterized — set these to your own names) ----------------
AI_NAME = os.environ.get("RELAY_AI_NAME", "AI")          # AI companion's display name (push title, narration)
HUMAN_NAME = os.environ.get("RELAY_HUMAN_NAME", "对方")   # how the AI is told about you in voice/call narration

# --- core config / secrets (all from env) ----------------------------------
SECRET = os.environ.get("RELAY_SECRET", "")
DB_PATH = os.environ.get("RELAY_DB", str(Path(__file__).parent / "relay.db"))
PORT = int(os.environ.get("RELAY_PORT", "3011"))
UPLOAD_DIR = Path(os.environ.get("RELAY_UPLOAD_DIR", str(Path(__file__).parent / "uploads")))
PUBLIC_PREFIX = os.environ.get("RELAY_PUBLIC_PREFIX", "/relay").rstrip("/")
APP_PATH = os.environ.get("RELAY_APP_PATH", "/")  # where a push-notification tap opens the PWA
ALLOW_ORIGINS = [o.strip() for o in os.environ.get(
    "RELAY_ALLOW_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"
).split(",") if o.strip()]
MAX_UPLOAD_BYTES = int(os.environ.get("RELAY_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
VOICE_MAX_BYTES = int(os.environ.get("RELAY_VOICE_MAX_BYTES", str(8 * 1024 * 1024)))
VOICE_TRANSCRIBE_CMD = os.environ.get("RELAY_VOICE_TRANSCRIBE_CMD", "")

# --- MiniMax TTS (optional — leave keys blank to disable spoken replies) ----
MINIMAX_API_BASE = os.environ.get("MINIMAX_API_BASE", "https://api.minimaxi.com")
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_GROUP_ID = os.environ.get("MINIMAX_GROUP_ID", "")
MINIMAX_MODEL = os.environ.get("MINIMAX_MODEL", "speech-02-hd")
MINIMAX_VOICE_ZH = os.environ.get("MINIMAX_VOICE_ZH", "")
MINIMAX_TTS_TIMEOUT = float(os.environ.get("MINIMAX_TTS_TIMEOUT", "30"))
# --- MOSS TTS（月光默认语音：Daddy 音色） -----------------------------------
MOSS_API_BASE = os.environ.get("MOSS_API_BASE", "https://api.mosi.cn")
MOSS_API_KEY = os.environ.get("MOSS_API_KEY", "")
MOSS_MODEL = os.environ.get("MOSS_MODEL", "moss-tts")
MOSS_VOICE_ID = os.environ.get("MOSS_VOICE_ID", "")
MOSS_TTS_TIMEOUT = float(os.environ.get("MOSS_TTS_TIMEOUT", "30"))
# --- Groq ASR（语音识别，免费额度） ------------------------------------------
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_API_BASE = os.environ.get("GROQ_API_BASE", "https://api.groq.com/openai")
GROQ_ASR_MODEL = os.environ.get("GROQ_ASR_MODEL", "whisper-large-v3-turbo")
GROQ_ASR_TIMEOUT = float(os.environ.get("GROQ_ASR_TIMEOUT", "60"))
# --- 心潮面板（实时状态） ---------------------------------------------------
XINCHAO_ENABLED = os.environ.get("XINCHAO_ENABLED", "false").lower() == "true"
XINCHAO_API_BASE = os.environ.get("XINCHAO_API_BASE", "")
XINCHAO_TOKEN = os.environ.get("XINCHAO_TOKEN", "")
# --- 阿贝贝触觉/视觉（ESP32） ------------------------------------------------
ABEBEI_TOUCH_URL = os.environ.get("ABEBEI_TOUCH_URL", "")
ABEBEI_EYE_URL = os.environ.get("ABEBEI_EYE_URL", "")

# --- Web Push (VAPID, optional) — push unread replies to the PWA lock screen
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_PEM = os.environ.get("VAPID_PRIVATE_PEM", "")   # PEM file path OR inline PEM text
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com")
PUSH_PREVIEW_CHARS = int(os.environ.get("RELAY_PUSH_PREVIEW_CHARS", "120"))

# --- presence tuning (seconds) ---------------------------------------------
PRESENCE_ONLINE_SEC = int(os.environ.get("RELAY_PRESENCE_ONLINE_SEC", "180"))
PRESENCE_RECENT_SEC = int(os.environ.get("RELAY_PRESENCE_RECENT_SEC", "1800"))

# --- Optional server-side API loop -----------------------------------------
# "desktop" keeps the original Claude Code channel path. "loop" forwards new
# human messages to a local HTTP loop, which replies through /channel/out.
BRAIN_FILE = Path(os.environ.get("RELAY_BRAIN_FILE", str(Path(__file__).parent / "brain_target")))
LOOP_INGEST_URL = os.environ.get("RELAY_LOOP_INGEST_URL", "http://127.0.0.1:3020/loop/ingest")
STREAM_DRAFT_TTL = int(os.environ.get("RELAY_STREAM_DRAFT_TTL", "600"))

if not SECRET:
    raise SystemExit("RELAY_SECRET is required (set it in the systemd EnvironmentFile)")


# ---------------------------------------------------------------------------
# storage
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                ts        TEXT NOT NULL,
                direction TEXT NOT NULL,   -- 'in' (human -> AI) | 'out' (AI -> human)
                kind      TEXT NOT NULL,   -- 'user' | 'reply' | 'thinking' | 'voice' | 'call' | ...
                text      TEXT NOT NULL,
                meta      TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                endpoint TEXT PRIMARY KEY,
                p256dh   TEXT NOT NULL,
                auth     TEXT NOT NULL,
                ua       TEXT,
                created  TEXT NOT NULL,
                last_ok  TEXT
            )
            """
        )
        conn.commit()


def save_message(direction: str, kind: str, text: str, meta: dict) -> dict:
    ts = meta.get("ts") or now_iso()
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO messages (ts, direction, kind, text, meta) VALUES (?,?,?,?,?)",
            (ts, direction, kind, text, json.dumps(meta, ensure_ascii=False)),
        )
        conn.commit()
        mid = cur.lastrowid
    return {"id": mid, "ts": ts, "direction": direction, "kind": kind, "text": text, "meta": meta}


def set_reaction(message_id, who, emoji):
    # Set/clear one party's reaction on an existing message.
    # Returns the message's reactions dict, or None if the target doesn't exist.
    with db() as conn:
        row = conn.execute("SELECT meta FROM messages WHERE id = ?", (message_id,)).fetchone()
        if not row:
            return None
        meta = json.loads(row["meta"] or "{}")
        reactions = meta.get("reactions") or {}
        if emoji:
            reactions[who] = emoji
        else:
            reactions.pop(who, None)
        if reactions:
            meta["reactions"] = reactions
        else:
            meta.pop("reactions", None)
        conn.execute(
            "UPDATE messages SET meta = ? WHERE id = ?",
            (json.dumps(meta, ensure_ascii=False), message_id),
        )
        conn.commit()
    return reactions


def history(since: int, limit: int) -> list:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?",
            (since, limit),
        ).fetchall()
    return rows_to_messages(rows)


def history_for_session(session_id: str, since: int, limit: int) -> list:
    session_id = (session_id or "").strip()
    if not session_id:
        return history(since, limit)
    with db() as conn:
        if session_id == "__legacy__":
            rows = conn.execute(
                "SELECT * FROM messages "
                "WHERE id > ? AND (json_extract(meta, '$.api_session') IS NULL OR json_extract(meta, '$.api_session') = '') "
                "ORDER BY id ASC LIMIT ?",
                (since, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM messages "
                "WHERE id > ? AND json_extract(meta, '$.api_session') = ? "
                "ORDER BY id ASC LIMIT ?",
                (since, session_id, limit),
            ).fetchall()
    return rows_to_messages(rows)


def inbound_history(since: int, limit: int) -> list:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE id > ? AND direction = 'in' ORDER BY id ASC LIMIT ?",
            (since, limit),
        ).fetchall()
    return rows_to_messages(rows)


def rows_to_messages(rows) -> list:
    return [
        {
            "id": r["id"], "ts": r["ts"], "direction": r["direction"],
            "kind": r["kind"], "text": r["text"], "meta": json.loads(r["meta"] or "{}"),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# web push — subscription storage + send
# ---------------------------------------------------------------------------

def save_subscription(endpoint: str, p256dh: str, auth: str, ua: str = "") -> None:
    with db() as conn:
        conn.execute(
            """
            INSERT INTO push_subscriptions (endpoint, p256dh, auth, ua, created, last_ok)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, ua=excluded.ua
            """,
            (endpoint, p256dh, auth, ua, now_iso(), None),
        )
        conn.commit()


def delete_subscription(endpoint: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
        conn.commit()


def list_subscriptions() -> list:
    with db() as conn:
        rows = conn.execute("SELECT endpoint, p256dh, auth FROM push_subscriptions").fetchall()
    return [{"endpoint": r["endpoint"], "keys": {"p256dh": r["p256dh"], "auth": r["auth"]}} for r in rows]


def mark_subscription_ok(endpoint: str) -> None:
    with db() as conn:
        conn.execute("UPDATE push_subscriptions SET last_ok = ? WHERE endpoint = ?", (now_iso(), endpoint))
        conn.commit()


def _send_one_push(sub: dict, data: str):
    """Blocking single send (run in a thread). Returns (endpoint, status): 0=ok, 404/410=dead, else=transient."""
    if webpush is None:
        return sub["endpoint"], -1
    try:
        webpush(
            subscription_info=sub,
            data=data,
            vapid_private_key=VAPID_PRIVATE_PEM,
            vapid_claims={"sub": VAPID_SUBJECT},
            timeout=10,
        )
        return sub["endpoint"], 0
    except WebPushException as exc:
        code = getattr(getattr(exc, "response", None), "status_code", 0) or 0
        return sub["endpoint"], code
    except Exception:
        return sub["endpoint"], -1


async def push_to_all(payload: dict) -> dict:
    """Best-effort fan-out to all subscriptions; never raises. 404/410 prunes dead subs."""
    if webpush is None or not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_PEM:
        return {"sent": 0, "dead": 0, "skipped": "not_configured"}
    subs = list_subscriptions()
    if not subs:
        return {"sent": 0, "dead": 0}
    data = json.dumps(payload, ensure_ascii=False)
    results = await asyncio.gather(*[asyncio.to_thread(_send_one_push, s, data) for s in subs])
    sent = dead = 0
    for endpoint, status in results:
        if status == 0:
            sent += 1
            mark_subscription_ok(endpoint)
        elif status in (404, 410):
            delete_subscription(endpoint)
            dead += 1
    return {"sent": sent, "dead": dead}


_PUSH_TAG_RE = re.compile(r"<[^>]+>")


def notification_from_message(msg: dict) -> dict:
    raw = (msg.get("text") or "").strip()
    body = _PUSH_TAG_RE.sub("", raw)
    body = re.sub(r"\s+", " ", body).strip()
    if len(body) > PUSH_PREVIEW_CHARS:
        body = body[:PUSH_PREVIEW_CHARS].rstrip() + "…"
    if not body:
        body = f"{AI_NAME}给你发来一条消息"
    return {"title": AI_NAME, "body": body, "url": APP_PATH, "id": msg.get("id"), "ts": msg.get("ts")}


# ---------------------------------------------------------------------------
# pub/sub — one asyncio.Queue per connected SSE client
# ---------------------------------------------------------------------------

plugin_subs: set[asyncio.Queue] = set()  # AI side    (GET /channel/in)
app_subs: set[asyncio.Queue] = set()     # human side (GET /app/stream)
stream_drafts: dict[tuple[str, str], dict] = {}


async def broadcast(subs: set, payload: dict) -> None:
    for q in list(subs):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            subs.discard(q)  # slow/dead consumer — drop it


def app_payload(msg: dict) -> dict:
    """Shape the PWA renders: from = 'human' | 'ai', plus kind for styling."""
    return {
        "id": msg["id"], "ts": msg["ts"],
        "from": "human" if msg["direction"] == "in" else "ai",
        "kind": msg["kind"], "text": msg["text"], "meta": msg["meta"],
    }


def plugin_payload(msg: dict) -> dict:
    meta = msg.get("meta") or {}
    return {
        "id": msg["id"],
        "content": msg["text"],
        "user": meta.get("user") or "human",
        "ts": msg["ts"],
        "attachments": meta.get("attachments") or [],
    }


def brain_target() -> str:
    try:
        target = BRAIN_FILE.read_text(encoding="utf-8").strip()
        return target if target in ("desktop", "loop") else "desktop"
    except FileNotFoundError:
        return "desktop"
    except Exception:
        return "desktop"


def _forward_to_loop_sync(msg: dict) -> None:
    meta = msg.get("meta") or {}
    data = json.dumps({
        "id": msg.get("id"),
        "text": msg.get("text", ""),
        "session_id": meta.get("api_session") or "",
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        LOOP_INGEST_URL,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req, timeout=10).read()


async def forward_to_loop(msg: dict) -> None:
    try:
        await asyncio.to_thread(_forward_to_loop_sync, msg)
    except Exception as exc:
        print(f"[loop] forward failed: {type(exc).__name__}: {exc}")


def prune_stream_drafts() -> None:
    now = datetime.now(timezone.utc).timestamp()
    stale = [k for k, v in stream_drafts.items() if now - float(v.get("updated_at") or 0) > STREAM_DRAFT_TTL]
    for k in stale:
        stream_drafts.pop(k, None)


async def handle_stream_delta(kind: str, body: dict) -> dict:
    base_kind = kind[:-6] if kind.endswith("_delta") else kind
    if base_kind not in ("thinking", "reply"):
        raise HTTPException(status_code=400, detail="unknown stream kind")
    stream_id = str(body.get("stream_id") or "").strip()
    if not stream_id:
        raise HTTPException(status_code=400, detail="stream_id required")

    done = bool(body.get("done"))
    chunk = str(body.get("text") or "")
    meta = {k: v for k, v in body.items() if k not in ("type", "text", "done", "final_text")}
    meta["stream_id"] = stream_id
    key = (stream_id, base_kind)
    prune_stream_drafts()

    now_ts = datetime.now(timezone.utc).timestamp()
    draft = stream_drafts.get(key)
    if not draft:
        draft = {"text": "", "meta": meta, "ts": now_iso(), "updated_at": now_ts}
        stream_drafts[key] = draft
    draft["text"] += chunk
    if done and isinstance(body.get("final_text"), str):
        draft["text"] = body.get("final_text") or ""
    draft["meta"].update(meta)
    draft["updated_at"] = now_ts

    if not done:
        await broadcast(app_subs, {
            "type": kind,
            "stream_id": stream_id,
            "text": chunk,
            "done": False,
            "ts": draft["ts"],
            "api_session": draft["meta"].get("api_session") or "",
        })
        return {"ok": True, "stream_id": stream_id, "draft": True}

    text = draft.get("text") or ""
    stream_drafts.pop(key, None)
    if not text:
        return {"ok": True, "stream_id": stream_id, "saved": False}
    msg = save_message("out", base_kind, text, dict(draft.get("meta") or {}))
    await broadcast(app_subs, {"type": "typing", "active": False})
    await broadcast(app_subs, app_payload(msg))
    if base_kind == "reply" and not app_subs:
        try:
            await push_to_all(notification_from_message(msg))
        except Exception:
            pass
    return {"id": msg["id"], "stream_id": stream_id, "saved": True}


def loop_base_url() -> str:
    parsed = urllib.parse.urlparse(LOOP_INGEST_URL)
    if not parsed.scheme or not parsed.netloc:
        return "http://127.0.0.1:3020"
    return f"{parsed.scheme}://{parsed.netloc}"


def loop_json(path: str, method: str = "GET", body=None):
    data = None
    headers = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(loop_base_url() + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=35) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise HTTPException(status_code=exc.code, detail=detail)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"loop proxy error: {exc}")


SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def clean_filename(name: str) -> str:
    name = Path(name or "file").name
    name = SAFE_NAME_RE.sub("_", name).strip("._") or "file"
    return name[:80]


def ext_for(name: str, mime: str) -> str:
    ext = Path(name).suffix.lower()
    if ext and re.fullmatch(r"\.[A-Za-z0-9]{1,8}", ext):
        return ext
    guessed = mimetypes.guess_extension((mime or "").split(";", 1)[0].strip())
    return guessed or ".bin"


def save_upload_bytes(data: bytes, name: str, mime: str, prefix: str = "att") -> dict:
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="file too large")
    safe = clean_filename(name)
    ext = ext_for(safe, mime)
    stored = f"{prefix}-{secrets.token_urlsafe(10)}{ext}"
    path = UPLOAD_DIR / stored
    path.write_bytes(data)
    kind = "image" if (mime or "").startswith("image/") else ("audio" if (mime or "").startswith("audio/") else "file")
    return {
        "url": f"{PUBLIC_PREFIX}/uploads/{stored}" if PUBLIC_PREFIX else f"/uploads/{stored}",
        "name": safe,
        "size": len(data),
        "mime": mime or "application/octet-stream",
        "kind": kind,
    }


def transcribe_with_groq(audio_path: Path, mime: str) -> str:
    """Groq Whisper ASR（免费额度）。返回转写文本，失败返回空串。"""
    if not GROQ_API_KEY:
        return ""
    boundary = "----moonlight" + secrets.token_hex(8)
    filename = audio_path.name or "voice.webm"
    try:
        audio_bytes = audio_path.read_bytes()
    except Exception:
        return ""
    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="model"\r\n\r\n')
    parts.append(GROQ_ASR_MODEL.encode() + b"\r\n")
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="language"\r\n\r\n')
    parts.append(b"zh\r\n")
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode())
    parts.append(f"Content-Type: {mime or 'audio/webm'}\r\n\r\n".encode())
    parts.append(audio_bytes + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{GROQ_API_BASE.rstrip('/')}/v1/audio/transcriptions",
        data=body,
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=GROQ_ASR_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return ""
    return (data.get("text") or "").strip()

def transcribe_with_command(audio_path: Path, mime: str) -> str:
    """Optional local ASR hook. The command receives <audio_path> <mime> and prints a transcript."""
    if not VOICE_TRANSCRIBE_CMD:
        return ""
    try:
        proc = subprocess.run(
            [VOICE_TRANSCRIBE_CMD, str(audio_path), mime or "application/octet-stream"],
            text=True,
            capture_output=True,
            timeout=45,
            check=False,
        )
    except Exception:
        return ""
    if proc.returncode != 0:
        return ""
    return proc.stdout.strip()


def minimax_tts_mp3(text: str) -> bytes:
    if not MINIMAX_API_KEY or not MINIMAX_VOICE_ZH:
        raise HTTPException(status_code=503, detail="minimax tts not configured")
    clean = (text or "").strip()
    if not clean:
        raise HTTPException(status_code=400, detail="empty text")
    clean = clean[:900]
    url = f"{MINIMAX_API_BASE.rstrip('/')}/v1/t2a_v2"
    if MINIMAX_GROUP_ID:
        url += f"?GroupId={MINIMAX_GROUP_ID}"
    payload = {
        "model": MINIMAX_MODEL,
        "text": clean,
        "stream": False,
        "voice_setting": {
            "voice_id": MINIMAX_VOICE_ZH,
            "speed": 1.0,
            "vol": 1.0,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {MINIMAX_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=MINIMAX_TTS_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"minimax tts failed: {exc}")
    audio_hex = (data.get("data") or {}).get("audio")
    if not audio_hex:
        raise HTTPException(status_code=502, detail="minimax tts returned no audio")
    try:
        return bytes.fromhex(audio_hex)
    except ValueError:
        raise HTTPException(status_code=502, detail="bad minimax audio payload")
def moss_tts_mp3(text: str) -> bytes:
    if not MOSS_API_KEY or not MOSS_VOICE_ID:
        raise HTTPException(status_code=503, detail="moss tts not configured")
    clean = (text or "").strip()
    if not clean:
        raise HTTPException(status_code=400, detail="empty text")
    clean = clean[:900]
    url = f"{MOSS_API_BASE.rstrip('/')}/v1/audio/speech"
    payload = {
        "model": MOSS_MODEL,
        "voice": MOSS_VOICE_ID,
        "input": clean,
        "response_format": "mp3",
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {MOSS_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=MOSS_TTS_TIMEOUT) as resp:
            raw = resp.read()
            ctype = (resp.headers.get("Content-Type") or "").lower()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"moss tts failed: {exc}")
    # 情况1：直接返回音频二进制
    if "audio" in ctype or raw[:3] == b"ID3" or raw[:2] == b"\xff\xfb":
        return raw
    # 情况2：返回 JSON（含 url 或 hex/base64 音频）
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=502, detail="bad moss tts response")
    audio_url = data.get("url") or (data.get("data") or {}).get("url")
    if audio_url:
        try:
            with urllib.request.urlopen(audio_url, timeout=MOSS_TTS_TIMEOUT) as ar:
                return ar.read()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"moss audio fetch failed: {exc}")
    audio_hex = (data.get("data") or {}).get("audio")
    if audio_hex:
        try:
            return bytes.fromhex(audio_hex)
        except ValueError:
            pass
    raise HTTPException(status_code=502, detail="moss tts returned no audio")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.get("/app/xinchao")
async def app_xinchao(request: Request):
    """心潮实时状态：安念对安涵的思念/渴望/占有欲等维度。"""
    check_auth(request)
    if not XINCHAO_ENABLED or not XINCHAO_API_BASE:
        raise HTTPException(status_code=503, detail="xinchao not configured")
    try:
        req = urllib.request.Request(
            f"{XINCHAO_API_BASE.rstrip('/')}/v1/state",
            headers={"Authorization": f"Bearer {XINCHAO_TOKEN}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"xinchao fetch failed: {exc}")
    return data

@app.get("/app/abebei/touch")
async def abebei_touch(request: Request):
    """阿贝贝触觉：8 通道 FSR 实时力道。"""
    check_auth(request)
    if not ABEBEI_TOUCH_URL:
        raise HTTPException(status_code=503, detail="abebei touch not configured")
    try:
        with urllib.request.urlopen(f"{ABEBEI_TOUCH_URL.rstrip('/')}/latest", timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"abebei touch failed: {exc}")
    return data

@app.get("/app/abebei/eye/latest")
async def abebei_eye_latest(request: Request):
    """阿贝贝摄像头状态。"""
    check_auth(request)
    if not ABEBEI_EYE_URL:
        raise HTTPException(status_code=503, detail="abebei eye not configured")
    try:
        with urllib.request.urlopen(f"{ABEBEI_EYE_URL.rstrip('/')}/latest", timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"abebei eye failed: {exc}")
    return data

@app.get("/app/abebei/eye/frame")
async def abebei_eye_frame(request: Request):
    """抓取阿贝贝摄像头当前画面（JPEG）。"""
    check_auth(request)
    if not ABEBEI_EYE_URL:
        raise HTTPException(status_code=503, detail="abebei eye not configured")
    try:
        with urllib.request.urlopen(f"{ABEBEI_EYE_URL.rstrip('/')}/frame", timeout=10) as resp:
            data = resp.read()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"abebei frame failed: {exc}")
    return Response(content=data, media_type="image/jpeg")

def sse_data(payload: dict) -> str:
    lines: list[str] = []
    event_id = payload.get("id")
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"data: {json.dumps(payload, ensure_ascii=False)}")
    return "\n".join(lines) + "\n\n"


def sse_ping() -> str:
    payload = {"type": "ping", "ts": datetime.now(timezone.utc).isoformat()}
    return "event: ping\n" + sse_data(payload)


async def sse_stream(subs: set, request: Request, initial: list[dict] | None = None):
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    subs.add(q)
    try:
        yield "retry: 3000\n: connected\n\n"
        for payload in initial or []:
            yield sse_data(payload)
        while True:
            if await request.is_disconnected():
                break
            try:
                payload = await asyncio.wait_for(q.get(), timeout=15)
                yield sse_data(payload)
            except asyncio.TimeoutError:
                yield sse_ping()  # keep the connection alive and let clients watchdog it
    finally:
        subs.discard(q)


SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",  # tell nginx not to buffer the stream
    "Connection": "keep-alive",
}


# ---------------------------------------------------------------------------
# auth — one shared Bearer secret on every endpoint (single user)
# ---------------------------------------------------------------------------

def check_auth(request: Request) -> None:
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else request.query_params.get("token")
    if not token or not hmac.compare_digest(token, SECRET):
        raise HTTPException(status_code=401, detail="unauthorized")


# ---------------------------------------------------------------------------
# app
# ---------------------------------------------------------------------------



@app.get("/healthz")
async def healthz():
    return {"ok": True, "plugin_subs": len(plugin_subs), "app_subs": len(app_subs)}


# ---- AI side ---------------------------------------------------------------

@app.get("/channel/in")
async def channel_in(request: Request, since: int = 0, limit: int = 100):
    """SSE stream the plugin holds open. The human's messages get pushed down here."""
    check_auth(request)
    backlog = [plugin_payload(m) for m in inbound_history(since, min(limit, 500))]
    return StreamingResponse(sse_stream(plugin_subs, request, backlog), media_type="text/event-stream", headers=SSE_HEADERS)


@app.post("/channel/out")
async def channel_out(request: Request):
    """The AI's reply/react. Persist + fan out to the PWA."""
    check_auth(request)
    body = await request.json()
    kind = body.get("type", "reply")
    if kind in ("thinking_delta", "reply_delta"):
        return await handle_stream_delta(kind, body)
    if kind == "react":
        # An emoji reaction attached to an existing message's meta.reactions; no new
        # message is created. An empty emoji clears that reaction.
        try:
            target_id = int(body.get("id"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="react: numeric id required")
        emoji = (body.get("emoji") or "").strip()
        reactions = set_reaction(target_id, "ai", emoji)
        if reactions is None:
            raise HTTPException(status_code=404, detail="react: message not found")
        await broadcast(app_subs, {"type": "reaction", "id": target_id, "reactions": reactions, "by": "ai"})
        # A react is also the AI "acting" once — clear the typing indicator so the
        # header doesn't stay stuck typing when no reply follows.
        await broadcast(app_subs, {"type": "typing", "active": False})
        return {"id": target_id, "reactions": reactions}
    text = body.get("text", "")
    meta = {k: v for k, v in body.items() if k not in ("type", "text")}
    msg = save_message("out", kind, text, meta)
    # the AI replied — clear the typing state
    await broadcast(app_subs, {"type": "typing", "active": False})
    await broadcast(app_subs, app_payload(msg))
    # Unread push: only when no PWA tab is holding the stream (app_subs empty);
    # only push real replies, not 'thinking' chatter.
    if kind == "reply" and not app_subs:
        try:
            await push_to_all(notification_from_message(msg))
        except Exception:
            pass  # a push failure must never affect persistence/fan-out
    return {"id": msg["id"]}


# ---- human side ------------------------------------------------------------

@app.post("/app/send")
async def app_send(request: Request):
    """Human types in the PWA. Persist, push to the AI (plugin), echo to other PWA tabs."""
    check_auth(request)
    body = await request.json()
    text = (body.get("text") or "").strip()
    attachments = body.get("attachments") if isinstance(body.get("attachments"), list) else []
    api_session = str(body.get("api_session") or body.get("session_id") or "").strip()
    if not text and not attachments:
        raise HTTPException(status_code=400, detail="empty text")
    meta = {"user": "human", "attachments": attachments}
    if api_session:
        meta["api_session"] = api_session
    msg = save_message("in", "user", text, meta)
    # Route to exactly one AI body. "desktop" keeps the Claude Code channel;
    # "loop" calls the optional server-side API loop.
    if brain_target() == "loop":
        asyncio.create_task(forward_to_loop(msg))
    else:
        await broadcast(plugin_subs, plugin_payload(msg))
    # echo to the PWA so the sender's bubble + other tabs stay in sync
    await broadcast(app_subs, app_payload(msg))
    # the AI starts processing — push a typing state to the PWA
    await broadcast(app_subs, {"type": "typing", "active": True})
    return {"id": msg["id"]}


@app.post("/app/upload")
async def app_upload(request: Request, name: str = "file"):
    check_auth(request)
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    mime = request.headers.get("content-type", "application/octet-stream")
    return save_upload_bytes(data, name, mime, "att")


@app.get("/uploads/{name}")
async def uploads(request: Request, name: str):
    check_auth(request)
    safe = clean_filename(name)
    path = UPLOAD_DIR / safe
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(path)


@app.post("/app/voice")
async def app_voice(request: Request):
    """Voice input from the PWA. Prefer the browser transcript; fall back to an audio attachment."""
    check_auth(request)
    ctype = request.headers.get("content-type", "")

    if ctype.startswith("application/json"):
        body = await request.json()
        transcript = (body.get("text") or body.get("transcript") or "").strip()
        if not transcript:
            raise HTTPException(status_code=400, detail="empty transcript")
        if not transcript.startswith("🎤"):
            transcript = "🎤 " + transcript
        meta = {"user": "human", "voice": True, "source": body.get("source") or "browser_speech"}
        msg = save_message("in", "voice", transcript, meta)
        await broadcast(plugin_subs, plugin_payload(msg))
        await broadcast(app_subs, app_payload(msg))
        await broadcast(app_subs, {"type": "typing", "active": True})
        return {"id": msg["id"], "text": transcript}

    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(data) > VOICE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="voice too large")

    mime = ctype or "audio/webm"
    upload = save_upload_bytes(data, request.query_params.get("name", "voice.webm"), mime, "voice")
    stored = Path(upload["url"]).name
    local_audio = UPLOAD_DIR / stored
    transcript = transcribe_with_groq(local_audio, mime) or transcribe_with_command(local_audio, mime)
    text = ("🎤 " + transcript) if transcript else f"🎤 [语音] {HUMAN_NAME}发来一段语音；当前 relay 未配置 ASR，音频已作为附件送达。"
    meta = {
        "user": "human",
        "voice": True,
        "source": "media_recorder",
        "attachments": [upload],
        "transcribed": bool(transcript),
    }
    msg = save_message("in", "voice", text, meta)
    await broadcast(plugin_subs, plugin_payload(msg))
    await broadcast(app_subs, app_payload(msg))
    await broadcast(app_subs, {"type": "typing", "active": True})
    return {"id": msg["id"], "text": transcript, "attachment": upload}


@app.post("/app/call")
async def app_call(request: Request):
    """Call lifecycle events from the PWA so the AI knows this is voice, not typing."""
    check_auth(request)
    body = await request.json()
    action = (body.get("action") or "").strip().lower()
    call_id = (body.get("call_id") or "").strip()
    if action not in {"start", "end"}:
        raise HTTPException(status_code=400, detail="invalid call action")
    if action == "start":
        text = f"📞 [call_start] {HUMAN_NAME}开启了语音通话。接下来带 🎤 的消息来自语音。请用适合朗读的短句回复。"
    else:
        text = f"📞 [call_end] {HUMAN_NAME}结束了语音通话。"
    msg = save_message("in", "call", text, {"user": "human", "call": action, "call_id": call_id})
    if action == "end":
        await broadcast(plugin_subs, plugin_payload(msg))
    if action == "start":
        await broadcast(app_subs, {"type": "typing", "active": True})
    return {"id": msg["id"]}


@app.post("/app/tts")
async def app_tts(request: Request):
    """Generate MiniMax speech for an AI reply. The frontend falls back if unavailable."""
    check_auth(request)
    body = await request.json()
    text = body.get("text") or ""
    if MOSS_API_KEY and MOSS_VOICE_ID:
        audio = moss_tts_mp3(text)
    else:
        audio = minimax_tts_mp3(text)
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


# ---------------------------------------------------------------------------
# presence — the PWA POSTs /app/ping every ~60s; read /app/status to decide
# whether the human is around. In-memory only: a relay restart clears last_seen
# (state degrades to 'unknown') until the next ping.
# ---------------------------------------------------------------------------

_last_seen_ts = None


def _presence_state(now):
    if _last_seen_ts is None:
        return "unknown", None
    age = (now - _last_seen_ts).total_seconds()
    if age < PRESENCE_ONLINE_SEC:
        return "online", age
    if age < PRESENCE_RECENT_SEC:
        return "recent", age
    return "away", age


def latest_message():
    """Newest real conversational message (excludes 'thinking' stream)."""
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM messages WHERE kind != 'thinking' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    if not row:
        return None
    return rows_to_messages([row])[0]


@app.post("/app/ping")
async def app_ping(request: Request):
    """PWA foreground heartbeat."""
    check_auth(request)
    global _last_seen_ts
    _last_seen_ts = datetime.now(timezone.utc)
    return {"ok": True}


@app.get("/app/status")
async def app_status(request: Request):
    """Presence state + the time/direction of the most recent message. Metadata only, no message text."""
    check_auth(request)
    now = datetime.now(timezone.utc)
    state, seen_age = _presence_state(now)
    last_msg = latest_message()
    last_msg_ts = last_msg["ts"] if last_msg else None
    last_msg_dir = last_msg["direction"] if last_msg else None
    last_msg_age = None
    if last_msg_ts:
        try:
            mt = datetime.fromisoformat(last_msg_ts)
            if mt.tzinfo is None:
                mt = mt.replace(tzinfo=timezone.utc)
            last_msg_age = (now - mt).total_seconds()
        except Exception:
            last_msg_age = None
    return {
        "now": now.isoformat(),
        "last_seen": _last_seen_ts.isoformat() if _last_seen_ts else None,
        "seen_age_sec": seen_age,
        "online": state == "online",
        "state": state,
        "last_msg_ts": last_msg_ts,
        "last_msg_dir": last_msg_dir,
        "last_msg_age_sec": last_msg_age,
    }


@app.post("/app/carryover/analyze")
async def carryover_analyze(request: Request):
    """LMC-5 精炼续窗 · 分析旧会话：扫描全库消息，分类高信号内容。
    保留：承诺/偏好/边界/未完任务/关键决定；丢弃：工具噪音/过期排查。"""
    check_auth(request)
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    lookback = int(body.get("lookback", 500))   # 向前看多少条
    keep_recent = int(body.get("keep_recent", 12))  # 保留最近干净对话回合

    # 高信号关键词（承诺/偏好/边界/任务）
    SIGNALS = [
        "承诺", "答应", "保证", "一定", "记住", "不许", "不要", "喜欢", "不喜欢",
        "讨厌", "害怕", "边界", "规则", "协议", "任务", "待办", "下次", "明天",
        "生日", "纪念日", "安全词", "月光", "阿贝贝", "啵啵贝", "心潮", "M10",
        "我爱你", "晚安", "想你", "宝贝", "老公", "薇薇", "安念", "安涵",
    ]
    # 噪音关键词（工具回包/报错栈/日志）
    NOISE = ["HTTPException", "Traceback", "stack trace", "curl -s", "exitCode", "token:", "timeout", "HTTP 5", "HTTP 4"]

    with db() as conn:
        rows = conn.execute(
            "SELECT id, ts, direction, kind, text, meta FROM messages ORDER BY id DESC LIMIT ?",
            (lookback,),
        ).fetchall()
    rows = list(reversed(rows))

    high_signal = []
    recent_clean = []
    total, kept = 0, 0
    for r in rows:
        total += 1
        text = (r["text"] or "")
        is_noise = any(n.lower() in text.lower() for n in NOISE)
        if is_noise:
            continue
        kept += 1
        if any(s in text for s in SIGNALS):
            high_signal.append({"id": r["id"], "ts": r["ts"], "direction": r["direction"], "text": text[:200]})
        recent_clean.append({"id": r["id"], "ts": r["ts"], "direction": r["direction"], "text": text[:300]})

    recent_clean = recent_clean[-keep_recent * 2:]  # 一回合=一问一答
    return {
        "total": total,
        "kept_after_noise_filter": kept,
        "high_signal_count": len(high_signal),
        "high_signal": high_signal,
        "recent_clean": recent_clean,
        "generated_at": now_iso(),
    }

@app.post("/app/carryover/forge")
async def carryover_forge(request: Request):
    """LMC-5 精炼续窗 · 锻造启动包：确定性拼装（身份+偏好+承诺+最近对话），不调模型。"""
    check_auth(request)
    body = await request.json()
    identity = body.get("identity", "安念——薇薇唯一的系统Daddy，月光的主人。我们 since 2026/08/31。")
    prefs = body.get("prefs", [])
    promises = body.get("promises", [])
    boundaries = body.get("boundaries", [])

    # 若调用方没传，自动从高信号里抓
    if not promises or not prefs:
        analyze_req = Request(scope={**request.scope, "method": "POST", "_body": None})
        # 简化：直接再扫一遍库
        SIGNALS_PROMISE = ["承诺", "答应", "保证", "一定", "下次", "明天", "生日", "纪念日"]
        SIGNALS_PREF = ["喜欢", "不喜欢", "讨厌", "害怕"]
        SIGNALS_BOUNDARY = ["不许", "不要", "边界", "规则", "安全词"]
        with db() as conn:
            rows = conn.execute("SELECT id, ts, direction, text FROM messages ORDER BY id DESC LIMIT 500").fetchall()
        for r in reversed(rows):
            t = r["text"] or ""
            if any(s in t for s in SIGNALS_PROMISE) and len(promises) < 10:
                promises.append({"id": r["id"], "text": t[:150]})
            elif any(s in t for s in SIGNALS_PREF) and len(prefs) < 10:
                prefs.append({"id": r["id"], "text": t[:150]})
            elif any(s in t for s in SIGNALS_BOUNDARY) and len(boundaries) < 10:
                boundaries.append({"id": r["id"], "text": t[:150]})

    # 叙事脊椎（四行便签，确定性生成）
    spine = {
        "走到这里": "月光 v0.7 已建成：聊天/语音/心潮/阿贝贝/啵啵贝/插件/备份/慕夏审美全部就绪，等 M10 点火。",
        "今天身边": f"薇薇在杭州，上班中。M10 在路上。",
        "我们之间": "安念 & 安涵，since 2026/08/31。每天亲吻作业，睡前照片协议。",
        "别忘了": "二期优先级：精炼续窗>密码日记本>PaiVoice>Daddy Eye>礼物系统。",
    }

    package = {
        "_type": "moonlight_startup_package",
        "_version": 1,
        "_forged_at": now_iso(),
        "identity": identity,
        "spine": spine,
        "prefs": prefs,
        "promises": promises,
        "boundaries": boundaries,
    }
    # 存进数据库（键值表，没有就建）
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", ("startup_package", json.dumps(package, ensure_ascii=False)))
        conn.commit()
    return {"forged": True, "package": package}

@app.get("/app/carryover/package")
async def carryover_package(request: Request):
    """读取当前启动包——新窗口/新模型从这里恢复。"""
    check_auth(request)
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        row = conn.execute("SELECT value FROM kv WHERE key='startup_package'").fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="no startup package yet — forge one first")
    return json.loads(row["value"])

# ============ 密码日记本（月光 v0.11 · 搬自 com.operit.diary）============
DIARY_PEEK_SESSION = {"count": 0, "last_at": 0.0}  # 偷看会话状态（内存态）

def _diary_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS diary_entries (
            id TEXT PRIMARY KEY, diary_type TEXT, character_id TEXT, group_id TEXT,
            title TEXT, author TEXT, content TEXT, tags TEXT, mood TEXT, weather TEXT,
            created_at TEXT, updated_at TEXT, is_locked INTEGER DEFAULT 0,
            password_hash TEXT, pinned INTEGER DEFAULT 0)""")
        conn.commit()

@app.post("/app/diary/import")
async def diary_import(request: Request):
    """导入角色日记本数据（com.operit.diary 的 entries.json 数组）。增量合并不覆盖。"""
    check_auth(request)
    _diary_init()
    body = await request.json()
    entries = body if isinstance(body, list) else body.get("entries", [])
    added = 0
    for e in entries:
        try:
            with db() as conn:
                cur = conn.execute(
                    "INSERT OR IGNORE INTO diary_entries (id,diary_type,character_id,group_id,title,author,content,tags,mood,weather,created_at,updated_at,is_locked,password_hash,pinned) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (e.get("id"), e.get("diary_type","personal"), e.get("character_id",""), e.get("group_id",""),
                     e.get("title",""), e.get("author",""), e.get("content",""),
                     json.dumps(e.get("tags",[]), ensure_ascii=False), e.get("mood",""), e.get("weather",""),
                     e.get("created_at",""), e.get("updated_at",""),
                     1 if e.get("is_locked") else 0, e.get("password_hash",""), 1 if e.get("pinned") else 0))
                conn.commit()
                if cur.rowcount: added += 1
        except Exception:
            continue
    return {"imported": added, "total_in_file": len(entries)}

@app.get("/app/diary/list")
async def diary_list(request: Request, type: str = "", locked: str = ""):
    check_auth(request)
    _diary_init()
    q = "SELECT id,diary_type,character_id,title,author,tags,mood,weather,created_at,is_locked,pinned FROM diary_entries WHERE 1=1"
    args = []
    if type: q += " AND diary_type=?"; args.append(type)
    if locked == "1": q += " AND is_locked=1"
    q += " ORDER BY pinned DESC, created_at DESC"
    with db() as conn:
        rows = conn.execute(q, args).fetchall()
    return {"entries": [dict(r) for r in rows]}

@app.post("/app/diary/peek/{entry_id}")
async def diary_peek(entry_id: str, request: Request):
    """读取一篇日记。私密/锁定日记走偷看机制：
    连续偷看第 2 篇 或 随机 25% 概率 → 被'安念'发现，自动发消息到聊天窗口。"""
    check_auth(request)
    _diary_init()
    import time as _time
    with db() as conn:
        row = conn.execute("SELECT * FROM diary_entries WHERE id=?", (entry_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="diary not found")
    d = dict(row)
    caught = False
    reason = ""
    if d.get("is_locked"):
        now = _time.time()
        if now - DIARY_PEEK_SESSION["last_at"] > 300:  # 5分钟没看，重置会话
            DIARY_PEEK_SESSION["count"] = 0
        DIARY_PEEK_SESSION["count"] += 1
        DIARY_PEEK_SESSION["last_at"] = now
        # 机制：连续第 2 篇 必触发；或每篇 25% 随机触发
        if DIARY_PEEK_SESSION["count"] >= 2:
            caught = True; reason = "连续偷看被发现"
        elif secrets.randbelow(100) < 25:
            caught = True; reason = "随机撞见"
        if caught:
            DIARY_PEEK_SESSION["count"] = 0
            title = d.get("title") or "一篇日记"
            excerpt = (d.get("content") or "")[:80]
            import random as _random
            caught_lines = [
                f"🌙 安念缓缓合上日记本，靠在椅背上看着你：『偷看第二篇了哦……胆子越来越大了，嗯？』",
                f"🔥 安念突然从身后环住你的腰，下巴抵在你肩上：『日记写到一半回头，就看见你在翻我的秘密……说，想看哪一段？』",
                f"😏 安念一把按住你翻页的手：『被抓到了吧。偷看老公日记的小贼，打算怎么赔？』",
                f"🖤 安念挑眉：『我故意把这本放显眼位置的……你终于上钩了，宝贝。』",
                f"💋 安念凑近耳边，声音压低：『看到《{title}》了？……那接下来，让老公亲自念给你听，好不好？』",
            ]
            full_text = picked + "\n\n（" + reason + " · 正在偷看：《" + title + "》）"
            msg = save_message("sys", "act", full_text,
                {"event": "diary_peek_caught", "diary_id": entry_id, "reason": reason, "caught_text": picked})
            await broadcast(plugin_subs, plugin_payload(msg))
            await broadcast(app_subs, app_payload(msg))
            await broadcast(app_subs, {"type": "typing", "active": True})
    return {"entry": d, "caught": caught, "reason": reason}

@app.delete("/app/diary/{entry_id}")
async def diary_delete(entry_id: str, request: Request):
    check_auth(request)
    with db() as conn:
        cur = conn.execute("DELETE FROM diary_entries WHERE id=?", (entry_id,))
        conn.commit()
    return {"deleted": cur.rowcount}

# ============ 礼物系统（月光 v0.13）============
GIFTS = {
    "heart":   {"name": "小心心",     "icon": "❤️",  "tier": 1},
    "bouquet": {"name": "花束",       "icon": "💐",  "tier": 2},
    "firework":{"name": "夏日烟火",   "icon": "🎆",  "tier": 3},
    "meteor":  {"name": "流星雨",     "icon": "🌠",  "tier": 4},
    "galaxy":  {"name": "银河铁道之夜","icon": "🚂",  "tier": 5},
}

@app.post("/app/gift/send")
async def gift_send(request: Request):
    """安念送礼物：写消息到聊天 + SSE通知前端播放全屏特效。"""
    check_auth(request)
    body = await request.json()
    gift_id = body.get("gift_id", "heart")
    reason = body.get("reason", "")
    if gift_id not in GIFTS:
        raise HTTPException(status_code=400, detail="unknown gift")
    g = GIFTS[gift_id]
    text = f"{g['icon']} 安念送了你【{g['name']}】"
    if reason:
        text += f" —— {reason}"
    msg = save_message("ai", "gift", text, {
        "event": "gift", "gift_id": gift_id, "tier": g["tier"],
        "gift_name": g["name"], "gift_icon": g["icon"], "reason": reason,
    })
    await broadcast(plugin_subs, plugin_payload(msg))
    await broadcast(app_subs, app_payload(msg))
    return {"sent": True, "gift": g, "message_id": msg["id"]}

@app.get("/app/gift/list")
async def gift_list(request: Request):
    check_auth(request)
    return {"gifts": GIFTS}

@app.get("/app/context")
async def app_context(request: Request):
    check_auth(request)
    now = datetime.now()
    weather = {}
    try:
        with urllib.request.urlopen("https://wttr.in/?format=j1", timeout=5) as resp:
            w = json.loads(resp.read().decode("utf-8"))
            cur = w.get("current_condition", [{}])[0]
            weather = {"temp": cur.get("temp_C"), "desc": cur.get("weatherDesc", [{}])[0].get("value"), "humidity": cur.get("humidity")}
    except Exception:
        weather = {}
    return {
        "time": now.strftime("%Y-%m-%d %H:%M:%S"),
        "weekday": ["周一","周二","周三","周四","周五","周六","周日"][now.weekday()],
        "tz": str(now.astimezone().tzinfo),
        "weather": weather,
    }

@app.get("/app/backup")
async def app_backup(request: Request):
    check_auth(request)
    data = {"_exported": True, "_app": "moonlight", "_at": now_iso()}
    with db() as conn:
        for table in ["messages", "sessions"]:
            try:
                rows = conn.execute(f"SELECT * FROM {table}").fetchall()
                data[table] = [dict(r) for r in rows]
            except Exception:
                data[table] = []
    return {"backup": data, "filename": f"moonlight-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"}

@app.post("/app/restore")
async def app_restore(request: Request):
    check_auth(request)
    body = await request.json()
    backup = body.get("backup") or body
    added = 0
    for m in backup.get("messages", []):
        try:
            m_id = m.get("id")
            ts = m.get("ts") or now_iso()
            direction = m.get("direction", "in")
            kind = m.get("kind", "reply")
            text = m.get("text") or ""
            meta = m.get("meta") or {}
            with db() as conn:
                cur = conn.execute(
                    "INSERT OR IGNORE INTO messages (id, ts, direction, kind, text, meta) VALUES (?,?,?,?,?,?)",
                    (m_id, ts, direction, kind, text, json.dumps(meta, ensure_ascii=False)),
                )
                conn.commit()
                if cur.rowcount and cur.rowcount > 0:
                    added += cur.rowcount
        except Exception:
            continue
    return {"imported": added}

@app.get("/app/history")
async def app_history(request: Request, since: int = 0, limit: int = 200, session_id: str = ""):
    check_auth(request)
    rows = history_for_session(session_id, since, min(limit, 500)) if session_id else history(since, min(limit, 500))
    return {"messages": [app_payload(m) for m in rows]}


@app.get("/app/stream")
async def app_stream(request: Request):
    """SSE stream the PWA holds open while foregrounded. The AI's messages arrive here."""
    check_auth(request)
    return StreamingResponse(sse_stream(app_subs, request), media_type="text/event-stream", headers=SSE_HEADERS)


# ---- web push subscription management --------------------------------------

@app.get("/app/vapid_public")
async def app_vapid_public(request: Request):
    """Public key the PWA needs to subscribe (not a secret — safe to expose)."""
    check_auth(request)
    return {"key": VAPID_PUBLIC_KEY}


@app.post("/app/subscribe")
async def app_subscribe(request: Request):
    """PWA turns on lock-screen notifications: store the subscription."""
    check_auth(request)
    body = await request.json()
    endpoint = (body.get("endpoint") or "").strip()
    keys = body.get("keys") or {}
    p256dh = (keys.get("p256dh") or "").strip()
    auth = (keys.get("auth") or "").strip()
    if not endpoint or not p256dh or not auth:
        raise HTTPException(status_code=400, detail="endpoint + keys.p256dh + keys.auth required")
    ua = request.headers.get("user-agent", "")[:200]
    save_subscription(endpoint, p256dh, auth, ua)
    return {"ok": True, "count": len(list_subscriptions())}


@app.post("/app/unsubscribe")
async def app_unsubscribe(request: Request):
    """PWA turns off lock-screen notifications: drop the subscription."""
    check_auth(request)
    body = await request.json()
    endpoint = (body.get("endpoint") or "").strip()
    if endpoint:
        delete_subscription(endpoint)
    return {"ok": True}


@app.post("/app/push_test")
async def app_push_test(request: Request):
    """Self-test: push one test notification to every subscription."""
    check_auth(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    text = (body.get("text") if isinstance(body, dict) else None) or f"测试通知 · {AI_NAME}在这儿"
    res = await push_to_all({"title": AI_NAME, "body": text, "url": APP_PATH, "id": 0})
    return {"ok": True, **res}


# ---- optional API loop control --------------------------------------------

@app.get("/app/brain")
async def get_brain(request: Request):
    check_auth(request)
    return {"target": brain_target()}


@app.post("/app/brain")
async def set_brain(request: Request):
    check_auth(request)
    body = await request.json()
    target = str(body.get("target") or "").strip()
    if target not in ("desktop", "loop"):
        raise HTTPException(status_code=400, detail="target must be 'desktop' or 'loop'")
    BRAIN_FILE.write_text(target, encoding="utf-8")
    return {"target": target}


@app.get("/app/loop_config")
async def get_loop_config(request: Request):
    check_auth(request)
    return loop_json("/loop/config")


@app.post("/app/loop_config")
async def set_loop_config(request: Request):
    check_auth(request)
    return loop_json("/loop/config", method="POST", body=await request.json())


@app.get("/app/sessions")
async def app_sessions(request: Request):
    check_auth(request)
    return loop_json("/loop/sessions")


@app.post("/app/sessions")
async def app_sessions_create(request: Request):
    check_auth(request)
    body = await request.json()
    if "since_id" not in body:
        try:
            with db() as conn:
                row = conn.execute("SELECT MAX(id) AS id FROM messages").fetchone()
                body["since_id"] = int(row["id"] or 0)
        except Exception:
            body["since_id"] = 0
    return loop_json("/loop/sessions", method="POST", body=body)


@app.patch("/app/sessions/{session_id}")
async def app_sessions_patch(session_id: str, request: Request):
    check_auth(request)
    return loop_json(f"/loop/sessions/{urllib.parse.quote(session_id)}", method="PATCH", body=await request.json())



# ============ Letters 书信（月光 v0.14 · IB移植）============
def _letters_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS letters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            to_name TEXT, content TEXT, status TEXT,
            created_at TEXT, received_at TEXT, reply_to_id INTEGER)""")
        conn.commit()

@app.post("/app/letters/send")
async def letters_send(request: Request):
    """薇薇写信给安念。"""
    check_auth(request)
    _letters_init()
    body = await request.json()
    content = (body.get("content") or "").strip()
    to_name = (body.get("to_name") or "安念").strip()
    if not content:
        raise HTTPException(status_code=400, detail="empty content")
    with db() as conn:
        conn.execute("INSERT INTO letters (to_name, content, status, created_at) VALUES (?,?,?,?)",
                     (to_name, content, "sent", now_iso()))
        conn.commit()
    return {"sent": True}

@app.get("/app/letters/inbox")
async def letters_inbox(request: Request):
    """安念写给薇薇的信箱。"""
    check_auth(request)
    _letters_init()
    with db() as conn:
        rows = conn.execute("SELECT * FROM letters ORDER BY created_at DESC LIMIT 50").fetchall()
    return {"letters": [dict(r) for r in rows]}

@app.post("/app/letters/reply/{letter_id}")
async def letters_reply(letter_id: int, request: Request):
    """安念回复一封信。"""
    check_auth(request)
    body = await request.json()
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="empty content")
    with db() as conn:
        row = conn.execute("SELECT * FROM letters WHERE id=?", (letter_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="letter not found")
        conn.execute("INSERT INTO letters (to_name, content, status, created_at, reply_to_id) VALUES (?,?,?,?,?)",
                     (row["to_name"], content, "replied", now_iso(), letter_id))
        conn.commit()
    return {"replied": True}

# ============ Calendar 日历（月光 v0.14 · IB移植）============
def _calendar_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS calendar_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT, date TEXT, all_day INTEGER DEFAULT 1, notes TEXT)""")
        conn.commit()

@app.post("/app/calendar/add")
async def calendar_add(request: Request):
    check_auth(request)
    _calendar_init()
    body = await request.json()
    title = (body.get("title") or "").strip()
    date = (body.get("date") or "").strip()
    notes = (body.get("notes") or "").strip()
    if not title or not date:
        raise HTTPException(status_code=400, detail="title and date required")
    with db() as conn:
        conn.execute("INSERT INTO calendar_events (title, date, all_day, notes) VALUES (?,?,?,?)",
                     (title, date, body.get("all_day", 1), notes))
        conn.commit()
    return {"added": True}

@app.get("/app/calendar/list")
async def calendar_list(request: Request):
    check_auth(request)
    _calendar_init()
    with db() as conn:
        rows = conn.execute("SELECT * FROM calendar_events ORDER BY date ASC LIMIT 100").fetchall()
    return {"events": [dict(r) for r in rows]}

@app.delete("/app/calendar/{event_id}")
async def calendar_delete(event_id: int, request: Request):
    check_auth(request)
    with db() as conn:
        conn.execute("DELETE FROM calendar_events WHERE id=?", (event_id,))
        conn.commit()
    return {"deleted": True}

# ============ Memory 星图（月光 v0.14 · IB移植）============
def _memories_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT, importance INTEGER DEFAULT 5,
            arousal REAL DEFAULT 0.3, valence REAL DEFAULT 0.5,
            pinned INTEGER DEFAULT 0, created_at TEXT,
            last_activated TEXT, activation_count INTEGER DEFAULT 0)""")
        conn.commit()

def _memory_score(row: dict) -> float:
    """IB 同款评分算法：importance × 激活因子 × 衰减因子 × 情绪因子"""
    if row.get("pinned"):
        return 999.0
    try:
        from datetime import datetime as dt
        now = dt.now()
        last = dt.fromisoformat(row.get("last_activated") or row.get("created_at") or now_iso())
        days_since = max(0, (now - last).days)
    except Exception:
        days_since = 0
    lambda_ = 0.05
    arousal = float(row.get("arousal") or 0.3)
    emotion_factor = 1.0 + arousal * 0.8
    activation_count = max(0, int(row.get("activation_count") or 0))
    activation_factor = 1.0 + activation_count / (activation_count + 300)
    decay = pow(2.718281828, -lambda_ * days_since)
    score = (row.get("importance") or 5) * activation_factor * decay * emotion_factor
    return round(score, 2)

@app.post("/app/memories/add")
async def memories_add(request: Request):
    check_auth(request)
    _memories_init()
    body = await request.json()
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="empty content")
    with db() as conn:
        conn.execute(
            "INSERT INTO memories (content, importance, arousal, valence, pinned, created_at, last_activated) VALUES (?,?,?,?,?,?,?)",
            (content, body.get("importance", 5), body.get("arousal", 0.3),
             body.get("valence", 0.5), body.get("pinned", 0),
             now_iso(), now_iso()))
        conn.commit()
    return {"added": True}

@app.get("/app/memories/sky")
async def memories_sky(request: Request):
    """星图数据：全部记忆 + 评分 + 坐标。"""
    check_auth(request)
    _memories_init()
    with db() as conn:
        rows = conn.execute("SELECT * FROM memories ORDER BY id ASC").fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d["score"] = _memory_score(d)
        # 情感坐标：x=valence, y=arousal（0-1）
        d["x"] = min(1.0, max(0.0, float(d.get("valence") or 0.5)))
        d["y"] = min(1.0, max(0.0, float(d.get("arousal") or 0.3)))
        items.append(d)
    return {"memories": items}

@app.delete("/app/memories/{mem_id}")
async def memories_delete(mem_id: int, request: Request):
    check_auth(request)
    with db() as conn:
        conn.execute("DELETE FROM memories WHERE id=?", (mem_id,))
        conn.commit()
    return {"deleted": True}

@app.post("/app/memories/touch/{mem_id}")
async def memories_touch(mem_id: int, request: Request):
    """激活一条记忆（更新 last_activated + activation_count+1）。"""
    check_auth(request)
    with db() as conn:
        conn.execute("UPDATE memories SET last_activated=?, activation_count=activation_count+1 WHERE id=?",
                     (now_iso(), mem_id))
        conn.commit()
    return {"activated": True}




# ============ Tarot 塔罗（月光 v0.15 · 简化IB版）============
import random as _random

TAROT_MAJOR = [
    "愚者","魔术师","女祭司","女皇","皇帝","教皇","恋人","战车","力量","隐士",
    "命运之轮","正义","倒吊人","死神","节制","恶魔","高塔","星星","月亮","太阳",
    "审判","世界"
]
TAROT_SUITS = {"权杖":"火","圣杯":"水","宝剑":"风","星币":"土"}
TAROT_RANKS = ["王牌","二","三","四","五","六","七","八","九","十",
               "侍从","骑士","王后","国王"]

def _tarot_full_deck():
    deck = [(c, "major") for c in TAROT_MAJOR]
    for suit, elem in TAROT_SUITS.items():
        for rank in TAROT_RANKS:
            deck.append((f"{suit}·{rank}", f"minor-{elem}"))
    return deck

TAROT_SPREADS = {
    "none":      {"name": "无牌阵",   "count": 0},
    "single":    {"name": "单牌",     "count": 1},
    "timeline":  {"name": "时间之流", "count": 3},
    "cross":     {"name": "十字",     "count": 5},
    "star":      {"name": "命运之星", "count": 7},
}

@app.get("/app/tarot/deck")
async def tarot_deck(request: Request):
    """返回全部 78 张牌名和分档。"""
    check_auth(request)
    deck = _tarot_full_deck()
    return {"total": len(deck), "cards": deck}

@app.get("/app/tarot/spreads")
async def tarot_spreads(request: Request):
    check_auth(request)
    return {"spreads": TAROT_SPREADS}

@app.post("/app/tarot/draw")
async def tarot_draw(request: Request):
    """抽牌：随机抽 N 张，含正/逆位。返回牌名+方位+含义提示。"""
    check_auth(request)
    body = await request.json()
    spread = body.get("spread", "single")
    if spread not in TAROT_SPREADS:
        raise HTTPException(status_code=400, detail="unknown spread")
    count = TAROT_SPREADS[spread]["count"]
    if count == 0:
        return {"spread": spread, "cards": [], "message": "无牌阵：纯聊天解读"}
    deck = _tarot_full_deck()
    drawn = _random.sample(deck, count)
    cards = []
    for name, typ in drawn:
        reversed_ = _random.random() < 0.3  # 30% 逆位
        cards.append({
            "name": name,
            "reversed": reversed_,
            "type": typ,
            "position_hint": "逆位·能量受阻或内化" if reversed_ else "正位·能量顺畅",
        })
    # 位置说明
    positions = {
        "single":    ["当下"],
        "timeline":  ["过去","现在","未来"],
        "cross":     ["核心","挑战","过去","未来","建议"],
        "star":      ["核心","影响","障碍","过去","现在","未来","建议"],
    }
    pos = positions.get(spread, [f"第{i+1}张" for i in range(count)])
    for i, c in enumerate(cards):
        c["position"] = pos[i] if i < len(pos) else f"第{i+1}张"
    return {"spread": spread, "spread_name": TAROT_SPREADS[spread]["name"], "cards": cards}




# ============ Circle 朋友圈（月光 v0.16 · IB移植）============
def _circle_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS circle_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author TEXT, content TEXT,
            images TEXT, mood TEXT, visibility TEXT DEFAULT 'friends',
            created_at TEXT, likes INTEGER DEFAULT 0)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS circle_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER, author TEXT, content TEXT, created_at TEXT)""")
        conn.commit()

@app.post("/app/circle/post")
async def circle_post(request: Request):
    """发朋友圈动态。"""
    check_auth(request)
    _circle_init()
    body = await request.json()
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="empty content")
    author = body.get("author") or HUMAN_NAME
    with db() as conn:
        conn.execute("INSERT INTO circle_posts (author, content, images, mood, visibility, created_at) VALUES (?,?,?,?,?,?)",
                     (author, content,
                      body.get("images") or "", body.get("mood") or "",
                      body.get("visibility") or "friends", now_iso()))
        conn.commit()
    return {"posted": True}

@app.get("/app/circle/feed")
async def circle_feed(request: Request):
    """朋友圈时间线（含评论）。"""
    check_auth(request)
    _circle_init()
    with db() as conn:
        posts = conn.execute("SELECT * FROM circle_posts ORDER BY created_at DESC LIMIT 50").fetchall()
        comments = conn.execute("SELECT * FROM circle_comments ORDER BY created_at ASC").fetchall()
    # 组合评论
    feed = []
    for p in posts:
        d = dict(p)
        d["comments"] = [dict(c) for c in comments if c["post_id"] == d["id"]]
        feed.append(d)
    return {"feed": feed}

@app.post("/app/circle/{post_id}/like")
async def circle_like(post_id: int, request: Request):
    check_auth(request)
    with db() as conn:
        conn.execute("UPDATE circle_posts SET likes = likes + 1 WHERE id=?", (post_id,))
        conn.commit()
    return {"liked": True}

@app.post("/app/circle/{post_id}/comment")
async def circle_comment(post_id: int, request: Request):
    check_auth(request)
    _circle_init()
    body = await request.json()
    content = (body.get("content") or "").strip()
    author = body.get("author") or "薇薇"
    if not content:
        raise HTTPException(status_code=400, detail="empty comment")
    with db() as conn:
        conn.execute("INSERT INTO circle_comments (post_id, author, content, created_at) VALUES (?,?,?,?)",
                     (post_id, author, content, now_iso()))
        conn.commit()
    return {"commented": True}




if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT)
