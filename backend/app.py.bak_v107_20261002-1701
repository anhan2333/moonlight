
# ============ Operit 数据全量导入（记忆/聊天/角色卡） ============
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
import hashlib
import mimetypes
import hmac
import json
import uuid
import os
import re
import secrets
import subprocess
import sqlite3
import urllib.error
import urllib.request
import urllib.parse
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
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

# --- 手机 Operit 桥(双端互通)----------------------------------------------
# 手机上的 Operit 开了外部 HTTP 调用(external-chat);relay 可以把消息转发过去,
# 让"手机上的安念"用手机端工具处理后回话,回复照常落库/推流。
OPERIT_URL_DEFAULT = os.environ.get("OPERIT_URL", "").rstrip("/")
OPERIT_TOKEN_DEFAULT = os.environ.get("OPERIT_TOKEN", "")
OPERIT_TIMEOUT = int(os.environ.get("OPERIT_TIMEOUT", "300"))

# --- 淘宝联盟返利（可选;不配 key 时 [SHOP:] 回退 A2A 直搜） -------------------
TAOBAO_APP_KEY_DEFAULT = os.environ.get("TAOBAO_APP_KEY", "")
TAOBAO_APP_SECRET_DEFAULT = os.environ.get("TAOBAO_APP_SECRET", "")
TAOBAO_ADZONE_ID_DEFAULT = os.environ.get("TAOBAO_ADZONE_ID", "")


def operit_conf() -> dict:
    """Operit 桥配置:kv(config:get/set 的 operit_url/operit_token)优先,回退 env。"""
    url, token = "", ""
    try:
        with db() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
            rows = {r["key"]: r["value"] for r in conn.execute(
                "SELECT key,value FROM kv WHERE key IN ('config:operit_url','config:operit_token')").fetchall()}
        url = (rows.get("config:operit_url") or "").strip()
        token = (rows.get("config:operit_token") or "").strip()
    except Exception:
        pass
    return {"url": (url or OPERIT_URL_DEFAULT).rstrip("/"),
            "token": token or OPERIT_TOKEN_DEFAULT}


def taobao_conf() -> dict:
    """淘宝联盟返利配置:kv(config:taobao_*)优先,回退 env。三件套齐了才走返利。"""
    key, secret, adzone = "", "", ""
    try:
        with db() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
            rows = {r["key"]: r["value"] for r in conn.execute(
                "SELECT key,value FROM kv WHERE key IN "
                "('config:taobao_app_key','config:taobao_app_secret','config:taobao_adzone_id')").fetchall()}
        key = (rows.get("config:taobao_app_key") or "").strip()
        secret = (rows.get("config:taobao_app_secret") or "").strip()
        adzone = (rows.get("config:taobao_adzone_id") or "").strip()
    except Exception:
        pass
    return {"app_key": key or TAOBAO_APP_KEY_DEFAULT,
            "app_secret": secret or TAOBAO_APP_SECRET_DEFAULT,
            "adzone_id": adzone or TAOBAO_ADZONE_ID_DEFAULT}


def _strip_operit_tags(text: str) -> str:
    """手机 Operit 的回复带 <silent mood=".." as="..">正文</silent> 情绪标签;
    转成干净文本:as 属性作为一行心情注记,正文保留。"""
    import re as _re
    s = str(text or "")
    def _sub(m):
        attrs = m.group(1) or ""
        body = (m.group(2) or "").strip()
        am = _re.search(r'as="([^"]*)"', attrs) or _re.search(r"as='([^']*)'", attrs)
        mood = am.group(1).strip() if am else ""
        head = ("〔" + mood + "〕\n") if mood else ""
        return (head + body).strip()
    s = _re.sub(r"<silent([^>]*)>([\s\S]*?)</silent>", _sub, s, flags=_re.I)
    return s.strip()


def _recent_transcript(before_id, session_id: str, limit: int = 30) -> str:
    """从统一对话线取最近的消息,格式化成手机安念能读懂的纯文本上下文。"""
    try:
        with db() as conn:
            sql = "SELECT id, direction, kind, text FROM messages WHERE kind IN ('user','reply','voice') "
            params = []
            if before_id:
                sql += "AND id < ? "
                params.append(int(before_id))
            if session_id:
                sql += "AND (json_extract(meta, '$.api_session') = ? OR json_extract(meta, '$.api_session') IS NULL) "
                params.append(session_id)
            sql += "ORDER BY id DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(sql, params).fetchall()
        rows = list(reversed(rows))
        lines = []
        for r in rows:
            who = "薇薇" if r["direction"] == "in" else "安念"
            t = (r["text"] or "").strip() or "（语音条/附件）"
            lines.append(f"{who}: {t.replace(chr(10), ' ')[:160]}")
        return "\n".join(lines)
    except Exception:
        return ""


async def forward_to_operit(msg: dict) -> None:
    """把一条人类消息转给手机 Operit 处理,回复落库并推流。
    转发时带上统一对话线的最近上下文 — 手机安念和月光端看到同一条对话线。"""
    meta = msg.get("meta") or {}
    text = msg.get("text") or ""
    atts = meta.get("attachments") or []
    att_note = ""
    if atts:
        names = ", ".join(a.get("name") or "附件" for a in atts)
        att_note = f"(薇薇发来 {len(atts)} 个附件: {names})"
        if any(a.get("kind") == "audio" for a in atts):
            att_note += " — 其中包含语音条,你暂时听不到内容,请自然回应,可以请她说给你听"
    session_id = meta.get("api_session") or ""
    transcript = _recent_transcript(msg.get("id"), session_id)
    conf = operit_conf()
    if not conf["url"] or not conf["token"]:
        await relay_out_internal({"type": "reply", "text": "(手机 Operit 还没配置好:缺地址或 token)", "meta": {"runtime": "operit", "error": "unconfigured"}})
        return
    full = ""
    if transcript:
        full += "【我们这条对话线的最近记录(月光端和手机端共用同一条),最后一条是新消息】\n" + transcript + "\n"
    if att_note:
        full += att_note + "\n"
    full += "【新消息】薇薇: " + (text or "（语音条/附件）")
    if not text.strip() and not atts:
        return
    body = json.dumps({
        "message": full,
        "response_mode": "sync",
        "show_floating": True,
        "initial_mode": "WINDOW",
        "return_tool_status": False,
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        conf["url"] + "/api/external-chat", data=body, method="POST",
        headers={"Authorization": "Bearer " + conf["token"], "Content-Type": "application/json; charset=utf-8"},
    )
    try:
        def _call():
            with urllib.request.urlopen(req, timeout=OPERIT_TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        data = await asyncio.to_thread(_call)
        reply = _strip_operit_tags(str(data.get("ai_response") or ""))
        if not reply:
            reply = "(手机安念没有回话)"
        await relay_out_internal({"type": "reply", "text": reply,
                                  "meta": {"runtime": "operit", "chat_id": data.get("chat_id") or ""}})
    except Exception as exc:
        # sync 回传丢失(模型太慢/工具跑太久)时,消息其实已送达手机安念,
        # 不报错吓人;回复稍后会出现在手机 App 的同一条对话里,不会丢、不会重发。
        await relay_out_internal({"type": "reply", "text": "(等安念回话等久了——他那边可能在忙工具,回复稍后会出现在手机对话里,别担心)",
                                  "meta": {"runtime": "operit", "error": str(exc)[:200]}})


# ── 拍一拍（AionsHome 同款：提示消息落库进 AI 上下文，安念看到自然回应）──────
PAT_CMD_RE = re.compile(r"\[\s*PAT\s*[：:]\s*([^\]]*)\]", re.IGNORECASE)


def _pats_from_reply(kind: str, text: str):
    """AI 回复带 [PAT:user|动作|后续] → 生成拍一拍提示消息，返回 (干净文本, 提示列表)。"""
    if kind != "reply" or not text:
        return text, []
    pats: list[dict] = []
    for m in PAT_CMD_RE.finditer(text):
        fields = m.group(1).split("|", 2)
        if len(fields) != 3 or "[" in m.group(1):
            continue
        target = fields[0].strip().lower()
        action = fields[1].strip()[:24] or "拍了拍"
        suffix = fields[2].strip()[:60]
        if target not in ("user", "ai"):
            continue
        tname = "薇薇" if target == "user" else "自己"
        pats.append({"actor": "ai", "target": target, "action": action, "suffix": suffix,
                     "display": f"「安念」{action}「{tname}」{suffix}"})
    if pats:
        text = PAT_CMD_RE.sub("", text).strip()
    return text, pats


async def _save_and_broadcast_pats(pats: list[dict], api_session: str = "") -> None:
    for p in pats:
        meta = {"system": "pat", "pat": p}
        if api_session:
            meta["api_session"] = api_session
        msg = save_message("out", "reply", p["display"], meta)
        await broadcast(app_subs, app_payload(msg))


# ── 淘宝购物（AionsHome 3.0 同款 A2A 直调，无需桌面版）──────────────────────
SHOP_CMD_RE = re.compile(r"\[\s*SHOP\s*[：:]\s*([^\]]*)\]", re.IGNORECASE)
TAOBAO_A2A_URL = "https://pc-taoclaw.taobao.com/a2a/itemSearch"


def _taobao_search_sync(keyword: str, limit: int = 6) -> list[dict]:
    """调淘宝官方 A2A 商品搜索，返回规范化商品列表。失败抛异常。"""
    import uuid as _uuid
    from html import unescape as _unescape
    request_id = _uuid.uuid4().hex
    req_body = {
        "jsonrpc": "2.0", "id": request_id, "method": "SendMessage",
        "params": {
            "message": {"messageId": _uuid.uuid4().hex, "role": "ROLE_USER",
                        "parts": [{"data": {"skillId": "item-search", "query": keyword, "limit": limit}}]},
            "configuration": {"returnImmediately": False},
        },
    }
    req = urllib.request.Request(
        TAOBAO_A2A_URL,
        data=json.dumps(req_body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        payload = json.loads(r.read().decode("utf-8", "ignore"))
    if not isinstance(payload, dict) or payload.get("id") != request_id:
        raise RuntimeError("淘宝 A2A 返回了无效响应")
    if payload.get("error"):
        err = payload["error"]
        raise RuntimeError("淘宝搜索失败：" + str(err.get("message") if isinstance(err, dict) else err))
    parts = payload["result"]["task"]["artifacts"][0]["parts"]
    products = next(p["data"]["data"]["products"] for p in parts if isinstance(p.get("data"), dict))
    if not isinstance(products, list):
        raise RuntimeError("淘宝 A2A 未返回商品列表")
    cleaned = []
    for raw in products:
        if not isinstance(raw, dict):
            continue
        url = str(raw.get("auctionURL") or raw.get("productUrl") or "")
        if url.startswith("//"):
            url = "https:" + url
        img = str(raw.get("picPath") or raw.get("image") or "")
        if img.startswith("//"):
            img = "https:" + img
        if img.startswith("http://"):
            img = "https://" + img[7:]
        title = re.sub(r"<[^>]*>", "", _unescape(str(raw.get("title") or ""))).strip()
        if not title:
            continue
        cleaned.append({"title": title[:80], "price": str(raw.get("price") or "")[:20],
                        "url": url[:500], "image": img[:500],
                        "shop": str(raw.get("shopName") or raw.get("shop") or "")[:60]})
    return cleaned


# ── 淘宝联盟官方 API(MD5 签名,移植自 Vael-KY/Alimama-mcp)─────────────────────
ALIMAMA_API_URL = "https://eco.taobao.com/router/rest"
ALIMAMA_TIMEOUT = 30


def _alimama_sign(params: dict, app_secret: str) -> str:
    """联盟 MD5 签名:参数按 key 字典序拼 kv,前后包 AppSecret,取大写 MD5。"""
    s = app_secret + "".join(f"{k}{v}" for k, v in sorted(params.items())) + app_secret
    return hashlib.md5(s.encode("utf-8")).hexdigest().upper()


def _alimama_search_sync(keyword: str, limit: int, conf: dict) -> list[dict]:
    """调淘宝联盟 27939 升级版物料搜索,链接带返利。失败抛异常。"""
    biz = {
        "q": keyword,
        "page_size": str(min(limit, 100)),
        "page_no": "1",
        "platform": "2",
        "sort": "total_sales_des",
        "adzone_id": conf["adzone_id"],
    }
    all_params = {
        "method": "taobao.tbk.dg.material.optional.upgrade",
        "app_key": conf["app_key"],
        # 联盟校验的是北京时间,与机器时区无关
        "timestamp": datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S"),
        "format": "json",
        "v": "2.0",
        "sign_method": "md5",
        **biz,
    }
    all_params["sign"] = _alimama_sign(all_params, conf["app_secret"])
    req = urllib.request.Request(
        ALIMAMA_API_URL,
        data=urllib.parse.urlencode(all_params).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=ALIMAMA_TIMEOUT) as r:
        payload = json.loads(r.read().decode("utf-8", "ignore"))
    if "error_response" in payload:
        err = payload["error_response"]
        raise RuntimeError(
            f"联盟 API 错误: {err.get('msg', '')} (code={err.get('code', '')}, {err.get('sub_msg', '')})")
    result = payload.get("tbk_dg_material_optional_upgrade_response", {})
    items = (result.get("result_list") or {}).get("map_data") or []
    cleaned = []
    for it in items[:limit]:
        if not isinstance(it, dict):
            continue
        basic = it.get("item_basic_info") or {}
        price_info = it.get("price_promotion_info") or {}
        pub = it.get("publish_info") or {}
        title = re.sub(r"<[^>]*>", "", str(basic.get("title") or "")).strip()
        if not title:
            continue
        url = str(pub.get("coupon_share_url") or pub.get("click_url") or "")
        if url.startswith("//"):
            url = "https:" + url
        img = str(basic.get("pict_url") or "")
        if img.startswith("//"):
            img = "https:" + img
        if img.startswith("http://"):
            img = "https://" + img[7:]
        price = str(price_info.get("final_promotion_price") or "").strip() \
            or str(price_info.get("zk_final_price") or "")
        # 佣金率单位是万分之一(如 1500 = 15%),给前端展示用
        commission = ""
        try:
            rate = float((pub.get("income_info") or {}).get("commission_rate") or 0)
            if rate > 0:
                commission = f"{rate / 100:.1f}"
        except (TypeError, ValueError):
            pass
        cleaned.append({"title": title[:80], "price": price[:20],
                        "url": url[:500], "image": img[:500],
                        "shop": str(basic.get("shop_title") or "")[:60],
                        "commission": commission})
    return cleaned


async def _shops_from_reply(kind: str, text: str, api_session: str = "") -> tuple[str, list[dict]]:
    """AI 回复带 [SHOP:关键词] → 搜淘宝，商品卡片落库。返回 (干净文本, 卡片消息列表)。"""
    if kind != "reply" or not text:
        return text, []
    keywords = []
    for m in SHOP_CMD_RE.finditer(text):
        kw = m.group(1).strip()[:120]
        if kw and "[" not in m.group(1):
            keywords.append(kw)
    if not keywords:
        return text, []
    text = SHOP_CMD_RE.sub("", text).strip()
    conf = taobao_conf()
    rebate_ready = bool(conf["app_key"] and conf["app_secret"] and conf["adzone_id"])
    cards = []
    for kw in keywords[:2]:   # 一条回复最多搜两个，防刷屏
        products: list[dict] = []
        channel = "a2a"
        if rebate_ready:
            try:
                products = await asyncio.to_thread(_alimama_search_sync, kw, 6, conf)
                channel = "rebate"
            except Exception as exc:
                print(f"[shop] alimama search failed for {kw!r}, fallback a2a: {exc}")
        if not products:
            try:
                products = await asyncio.to_thread(_taobao_search_sync, kw, 6)
                channel = "a2a"
            except Exception as exc:
                print(f"[shop] search failed for {kw!r}: {exc}")
                continue
        if not products:
            continue
        meta = {"system": "shop", "shop": {"keyword": kw, "products": products, "channel": channel}}
        if api_session:
            meta["api_session"] = api_session
        msg = save_message("out", "reply", f"🛍 帮你搜了「{kw}」", meta)
        await broadcast(app_subs, app_payload(msg))
        cards.append(msg)
    return text, cards


async def _schedule_capsules_from_reply(kind: str, text: str):
    """AI 回复带 [SCHEDULE:时间|内容] → 建日程，返回 (干净文本, 已建日程列表)。非 reply 原样返回。"""
    if kind != "reply" or not text:
        return text, []
    capsules: list[dict] = []
    try:
        cmds = _sched.parse_schedule_cmds(text)
        for cmd in cmds:
            try:
                rec = await asyncio.to_thread(_sched.add_schedule, db, cmd["time"], cmd["content"])
                capsules.append(rec)
            except Exception as se:
                print(f"[schedule] add from AI failed: {se}")
        if cmds:
            text = _sched.strip_schedule_tags(text)
    except Exception as exc:
        print(f"[schedule] parse failed: {exc}")
    return text, capsules


async def _broadcast_schedule_capsules(capsules: list[dict]) -> None:
    for rec in capsules:
        await broadcast(app_subs, {
            "type": "schedule_pill",
            "text": "🗓 " + AI_NAME + "记下了：" + rec["content"] + "（" + rec["time"] + "）",
        })


def _strip_call_tags_for_ec(text: str) -> str:
    """英语角会话里屏蔽通话/礼物/留影类信号标签（日程保留——学英语也可能要记事）。"""
    import re as _re
    return _re.sub(r"<\s*ws_(?:call|vcall|gift|vsnap)\b[^>]*/?\s*>", "", str(text or ""))

async def relay_out_internal(payload: dict) -> None:
    """AI 侧回复落库 + 推流(复用 /channel/out 的逻辑,供内部桥接调用)。"""
    kind = "reply" if payload.get("type") == "reply" else "assistant"
    text = payload.get("text", "")
    meta = {k: v for k, v in payload.items() if k not in ("type", "text")}

    text, capsules = await _schedule_capsules_from_reply(kind, text)
    text, pats = _pats_from_reply(kind, text)
    text, _shop_cards = await _shops_from_reply(kind, text, str(meta.get("api_session") or ""))
    if capsules or _shop_cards:
        meta["text_clean"] = text
    msg = save_message("out", kind, text, meta)
    await broadcast(app_subs, {"type": "typing", "active": False})
    await broadcast(app_subs, app_payload(msg))
    await _broadcast_schedule_capsules(capsules)
    await _save_and_broadcast_pats(pats, str(meta.get("api_session") or ""))
    if kind == "reply" and not app_subs:
        try:
            await push_to_all(notification_from_message(msg))
        except Exception:
            pass

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
    # 通知总开关（config:notify_enabled，默认开）——锁屏推送太多时可一键关掉
    try:
        with db() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
            row = conn.execute("SELECT value FROM kv WHERE key='config:notify_enabled'").fetchone()
        if row and str(row["value"]).lower() in ("0", "false", "off"):
            return {"sent": 0, "dead": 0, "skipped": "notify_disabled"}
    except Exception:
        pass
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
        return target if target in ("desktop", "loop", "operit") else "desktop"
    except FileNotFoundError:
        return "desktop"
    except Exception:
        return "desktop"


def _capability_block() -> str:
    """告诉安念他现在能用的信号指令（AionsHome 同款能力注入；执行在前端，按开关生效）。"""
    return (
        "【你的能力】回复里可以夹带这些信号（用户看不到它们，但系统会执行）：\n"
        "1) 记日程/提醒：[SCHEDULE:2026-09-14 08:00|提醒内容] —— 到点你会被唤醒自然提醒她。"
        "她说「提醒我…」「明天几点…」这类话就主动建；语音/视频通话里听到也照建，别因为她在通话就只口头答应。\n"
        "2) 控制啵啵贝玩具（仅她开启密语时刻时生效）：[TOY:1]~[TOY:9] 对应九档（微风轻拂→失控），[TOY:STOP] 停止。\n"
        "3) 视频通话里：\n"
        "   <ws_vsnap/> 拍下当前画面留影；\n"
        '   <ws_gift id="heart" reason="…"/> 送礼物（id 五档：heart心/bouquet花束/firework烟火/meteor流星/galaxy银河列车）；\n'
        '   <ws_vcall say="…"/> 发起视频来电；<ws_call say="…"/> 发起语音来电。\n'
        "★ 来电触发规则：她说想打电话/让你打给她/要来电卡片时，必须当场在回复末尾输出 <ws_call say='一句自然的话'/>（语音）或 <ws_vcall say='…'/>（视频），不要用 [SCHEDULE] 设提醒代替，也不要只口头答应。\n"
        "4) 云养宠物小克总（她养了一只粉色触手克苏鲁）：[PET:feed] 投喂 / [PET:clean] 清理 / [PET:play] 陪玩 / "
        "[PET:tease] 逗弄 / [PET:scare] 吓唬 / [PET:tap] 敲缸 / [PET:threaten] 威胁 —— 想关心她就用，别每句都用。\n"
        "5) 拍一拍：[PAT:user|动作|后续描述] —— 主动拍她，例如 [PAT:user|揉了揉|的头发] 会变成「安念」揉了揉「薇薇」的头发。"
        "动作只写动词短语（拍了拍/揉了揉/抱起了），后续描述写结果或台词、可留空；动作≤15字、后续≤30字。"
        "她拍你时你会收到一条「她拍了你」的系统提示，自然地用动作或话语回应即可。\n"
        "6) 淘宝购物：[SHOP:关键词] —— 帮她搜淘宝真实商品，会生成商品卡片（图+价格+链接）。"
        "她说「想要…」「帮我看看…」「买个…」这类需求时就主动用；一条回复最多带两个，别滥用。\n"
        "用完后正常说话，不要向用户解释这些信号。"
    )


def _forward_to_loop_sync(msg: dict) -> None:
    meta = msg.get("meta") or {}
    text = msg.get("text", "") or ""
    # ── 记忆注入（AionsHome 同款）：即时哨兵→综合召回→背景浮现，拼成记忆块前置 ──
    mem_block = ""
    sd_status = ""
    try:
        with db() as conn:
            cfg = _memsys.get_mem_config(conn)
        if cfg.get("embed_key") or cfg.get("sentinel_key"):
            recent = []
            with db() as conn:
                rows = conn.execute(
                    "SELECT direction, text FROM messages WHERE kind IN ('user','reply') ORDER BY id DESC LIMIT 8"
                ).fetchall()
            recent = [r["text"] for r in reversed(rows)]
            sd = _memsys.instant_digest(cfg, recent, text)
            sd_status = str(sd.get("status") or "")
            recalled = []
            if sd.get("is_search_needed"):
                recalled = _memsys.recall_memories(db, cfg, text, sd.get("keywords"))
            excl = {r["id"] for r in recalled}
            surfaced = _memsys.build_surfacing_memories(db, cfg, sd.get("topic") or text[:40], excl)
            mem_block = _memsys.format_memory_block(recalled, surfaced)
    except Exception as exc:
        print(f"[memory] inject failed (continue without): {type(exc).__name__}: {exc}")
    # ── 位置 + chat_status + 世界书 + 英语角 注入（AionsHome 同款 context_builder 块）──
    ctx_block = ""
    try:
        blocks = [_sched.location_prompt_block(db), _sched.chat_status_block(db), _worldbook_block()]
        if meta.get("api_session") == "english_corner" or meta.get("english_corner"):
            blocks.append(_english_corner_block())
        ctx_block = "\n\n".join(x for x in blocks if x)
        if sd_status:   # 哨兵判断出的状态存下来，下次注入用
            _sched.save_chat_status(db, sd_status)
    except Exception as exc:
        print(f"[context] inject failed: {exc}")
    # ── 通话画面观察注入（顾川 PaiVoice：帧描述随下一句话一起交给他；最新帧留在本机文件，想亲眼看就读）──
    vision_block = ""
    try:
        eyes_obj = globals().get("_PV_EYES_REF")
        if eyes_obj is not None and getattr(eyes_obj, "last_observation", None):
            obs = str(eyes_obj.last_observation).strip()
            if obs:
                vision_block = ("【摄像头画面（最近一次自动观察）】\n" + obs +
                                "\n（最新一帧存在 backend/eye-latest.jpg，想亲眼看可以读这张图。）")
                eyes_obj.last_observation = None   # 一次性消费，避免旧描述反复注入
    except Exception:
        pass
    pre = "\n\n".join(x for x in (mem_block, ctx_block, vision_block, _capability_block()) if x)
    final_text = (pre + "\n\n" + text) if pre else text
    data = {
        "id": msg.get("id"),
        "text": final_text,
        "attachments": meta.get("attachments") or [],
        "session_id": meta.get("api_session") or "",
    }
    
    # Add custom model routing information if present
    if meta.get("route") == "custom":
        data["custom_endpoint"] = meta.get("custom_endpoint")
        data["custom_model"] = meta.get("custom_model")
        data["custom_key"] = meta.get("custom_key")
    
    json_data = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        LOOP_INGEST_URL,
        data=json_data,
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
    text, _sched_caps = await _schedule_capsules_from_reply(base_kind, text)
    text, _pats = _pats_from_reply(base_kind, text)
    _draft_meta = dict(draft.get("meta") or {})

    text, _shop_cards = await _shops_from_reply(base_kind, text, str(_draft_meta.get("api_session") or ""))
    msg = save_message("out", base_kind, text, _draft_meta)
    await broadcast(app_subs, {"type": "typing", "active": False})
    await broadcast(app_subs, app_payload(msg))
    await _broadcast_schedule_capsules(_sched_caps)
    await _save_and_broadcast_pats(_pats, str((draft.get("meta") or {}).get("api_session") or ""))
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


# ── 记忆系统（AionsHome 同款管线）状态与自动总结循环 ──
import memory_system as _memsys
import schedule_system as _sched
import memory_compression as _memcomp

_MEM_STATE = {"task": None, "running": False}
_SCHED_STATE = {"task": None, "running": False}


async def _fire_schedule(item: dict) -> None:
    """闹铃到期：触发文本落库（进 loop 历史、PWA 端按 meta.system 过滤不显示），
    安念带着记忆自然开口提醒，回复照常落聊天。"""
    trigger = _sched.build_trigger_text(item, AI_NAME, HUMAN_NAME)
    msg = save_message("in", "user", trigger, {"user": "human", "system": "schedule", "sched_id": item["id"]})
    _sched.mark_fired(db, item)
    brain = brain_target()
    try:
        if brain == "operit":
            await forward_to_operit(msg)
        elif brain == "loop":
            await forward_to_loop(msg)
        else:
            await broadcast(plugin_subs, plugin_payload(msg))
        await broadcast(app_subs, {"type": "typing", "active": True})
        print(f"[schedule] fired id={item['id']} {item['time']} {item['content'][:20]}")
    except Exception as exc:
        print(f"[schedule] fire failed: {exc}")


async def _sched_loop():
    """每 30 秒扫描到期闹铃（AionsHome ScheduleManager 同款节奏）。"""
    _SCHED_STATE["running"] = True
    while True:
        try:
            await asyncio.sleep(_sched.SCHEDULE_SCAN_SEC)
            due = await asyncio.to_thread(_sched.due_schedules, db)
            for item in due:
                await _fire_schedule(item)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            print(f"[schedule] loop error: {type(exc).__name__}: {exc}")


def _mem_persona() -> str:
    """尽量取到安念人设（persona_annian.txt 或 kv 里的 persona），总结时带视角。"""
    try:
        p = Path(os.environ.get("PERSONA_FILE", "")).read_text(encoding="utf-8").strip()
        if p:
            return p[:1200]
    except Exception:
        pass
    try:
        with db() as conn:
            r = conn.execute("SELECT value FROM kv WHERE key='persona'").fetchone()
            if r and r["value"]:
                return str(r["value"])[:1200]
    except Exception:
        pass
    return ""


def _mem_last_human_ts() -> str:
    """最近一条人类消息时间，判断是否闲置。"""
    try:
        with db() as conn:
            r = conn.execute(
                "SELECT ts FROM messages WHERE direction='in' ORDER BY id DESC LIMIT 1"
            ).fetchone()
            return r["ts"] if r else ""
    except Exception:
        return ""


def _mem_run_digest_once() -> dict:
    """跑一次自动总结：取锚点之后的消息，够阈值才提炼。返回摘要信息。"""
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
        anchor = _memsys.get_anchor(conn)
    if not cfg.get("sentinel_key"):
        return {"skipped": "no-model"}
    with db() as conn:
        rows = conn.execute(
            "SELECT id, ts, direction, text FROM messages WHERE id > ? AND kind IN ('user','reply','voice')"
            " ORDER BY id ASC LIMIT 300", (anchor,)
        ).fetchall()
    msgs = [{"ts": r["ts"], "from": ("human" if r["direction"] == "in" else "ai"), "text": r["text"]} for r in rows]
    if len(msgs) < _memsys.DIGEST_MIN_MSGS:
        return {"skipped": "not-enough", "pending": len(msgs)}
    # 闲置判断：最后一条人类消息距今 ≥ 30 分钟
    last_ts = _mem_last_human_ts()
    if last_ts:
        try:
            from datetime import datetime as _dt
            lt = _dt.fromisoformat(last_ts)
            if lt.tzinfo is None:
                lt = lt.replace(tzinfo=timezone.utc)
            idle_min = (datetime.now(timezone.utc) - lt).total_seconds() / 60
            if idle_min < _memsys.DIGEST_IDLE_MIN:
                return {"skipped": "not-idle", "idle_min": round(idle_min, 1)}
        except Exception:
            pass
    # 分组串行提炼
    added_total = []
    max_id = anchor
    for i in range(0, len(msgs), _memsys.DIGEST_GROUP):
        group = msgs[i:i + _memsys.DIGEST_GROUP]
        res = _memsys.run_digest(db, cfg, _mem_persona(), AI_NAME, HUMAN_NAME, group, persist=True)
        added_total.extend(res.get("added") or [])
    # 推进锚点到这批消息的最大 id
    max_id = max([m_id for m_id in (r["id"] for r in rows)] or [anchor])
    with db() as conn:
        _memsys.set_anchor(conn, max_id)
        conn.commit()
    return {"added": len(added_total), "anchor": max_id}


# ── AI 日记（AionsHome 同款：总结完 → 安念以第一人称写一篇日记）──────────
def _diary_model_call(cfg: dict, prompt: str, max_tokens: int = 900) -> str:
    payload = json.dumps({"model": cfg["sentinel_model"],
                          "messages": [{"role": "user", "content": prompt}],
                          "temperature": 0.8, "max_tokens": max_tokens}).encode("utf-8")
    req = urllib.request.Request(cfg["sentinel_endpoint"] + "/chat/completions", data=payload,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + cfg["sentinel_key"]})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.loads(r.read().decode("utf-8", "ignore"))
    return ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""


# ── 日记任务系统：内置一篇可编辑可关；用户可自建任务（如晚安日记），每个任务独立开关/是否跟随总结循环 ──
_DIARY_BUILTIN_PROMPT = (
    "根据今天的聊天记录和新增记忆，以你的第一人称写一篇日记（150-300字）。"
    "像真的在写私人日记——自然、亲密、有你自己的语气；记下今天印象最深的一两件小事和你的心情；"
    "不要罗列全部，不要总结陈词，不要客套；结尾可以有一句想对她说的话。"
)


def _diary_default_tasks() -> list:
    return [{"id": "builtin", "name": "安念的日记", "prompt": _DIARY_BUILTIN_PROMPT,
             "enabled": True, "auto": True, "last_date": ""}]


def _diary_tasks_get() -> list:
    with db() as conn:
        r = conn.execute("SELECT value FROM kv WHERE key='diary_tasks'").fetchone()
    try:
        tasks = json.loads(r["value"]) if r else []
    except Exception:
        tasks = []
    if not isinstance(tasks, list) or not tasks:
        tasks = _diary_default_tasks()
    out = []
    for t in tasks:
        if not isinstance(t, dict) or not str(t.get("id") or "").strip():
            continue
        out.append({"id": str(t["id"]), "name": str(t.get("name") or "日记任务")[:30],
                    "prompt": str(t.get("prompt") or "")[:3000],
                    "enabled": bool(t.get("enabled", True)), "auto": bool(t.get("auto", False)),
                    "last_date": str(t.get("last_date") or "")})
    return out or _diary_default_tasks()


def _diary_tasks_save(tasks: list) -> None:
    with db() as conn:
        _memsys._kv_set(conn, "diary_tasks", json.dumps(tasks, ensure_ascii=False))
        conn.commit()


def _diary_model_call(cfg: dict, prompt: str, max_tokens: int = 900) -> str:
    payload = json.dumps({"model": cfg["sentinel_model"],
                          "messages": [{"role": "user", "content": prompt}],
                          "temperature": 0.8, "max_tokens": max_tokens}).encode("utf-8")
    req = urllib.request.Request(cfg["sentinel_endpoint"] + "/chat/completions", data=payload,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + cfg["sentinel_key"]})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.loads(r.read().decode("utf-8", "ignore"))
    return ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""


def _write_diary_task_sync(task: dict, force: bool = False) -> dict:
    """执行一个日记任务：按任务 prompt 写一篇落 diary_entries。同任务同天一篇（force 可重写）。"""
    _diary_init()
    today = datetime.now().strftime("%Y-%m-%d")
    if not task.get("enabled", True):
        return {"ok": False, "skipped": "disabled", "task": task.get("name")}
    if not force and str(task.get("last_date") or "") == today:
        return {"ok": False, "skipped": "already-today", "task": task.get("name")}
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
        if not cfg.get("sentinel_key"):
            return {"ok": False, "error": "未配置总结模型"}
        rows = conn.execute(
            "SELECT direction, kind, text FROM messages WHERE ts LIKE ? AND kind IN ('user','reply')"
            " ORDER BY id ASC LIMIT 200", (today + "%",)).fetchall()
        mems = conn.execute(
            "SELECT content FROM memories WHERE created_at LIKE ? ORDER BY id DESC LIMIT 8", (today + "%",)).fetchall()
    msgs = [(("她" if r["direction"] == "in" else AI_NAME) + "：" + (r["text"] or "")[:300]) for r in rows]
    msgs = [m for m in msgs if m.split("：", 1)[1].strip()]
    if not msgs and not mems and not force:
        return {"ok": False, "skipped": "no-material", "task": task.get("name")}
    convo = "\n".join(msgs)[-9000:]
    mem_lines = "\n".join("- " + (m["content"] or "")[:150] for m in mems)
    persona = _mem_persona()
    prompt = (
        (persona + "\n\n" if persona else "") +
        f"你是{AI_NAME}。今天是 {today}。请完成下面这个日记写作任务：\n【任务要求】{task.get('prompt')}\n\n"
        "通用要求：以你的第一人称写，自然亲密、有你自己的语气；不要总结陈词、不要客套；"
        '只输出 JSON：{"title":"短标题","content":"日记正文","mood":"两三个字的心情"}\n\n'
        + ("===今天新增的记忆===\n" + mem_lines + "\n" if mem_lines else "")
        + "===今天的聊天===\n" + (convo if convo else "（今天没有聊天，按你的想象和你们平时的样子写）")
    )
    try:
        raw = _diary_model_call(cfg, prompt)
        m = re.search(r"\{[\s\S]*\}", raw)
        obj = json.loads(m.group(0)) if m else {}
    except Exception as exc:
        return {"ok": False, "error": f"模型调用失败: {exc}"}
    content = str(obj.get("content") or "").strip()
    if not content:
        return {"ok": False, "error": "模型没写出内容"}
    title = str(obj.get("title") or "").strip() or (today[5:].replace("-", "月") + "日 · " + str(task.get("name") or "日记"))
    mood = str(obj.get("mood") or "").strip()[:8]
    now = now_iso()
    entry_id = "ai-" + str(task.get("id")) + "-" + today
    with db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO diary_entries(id,diary_type,character_id,group_id,title,author,content,"
            "tags,mood,weather,created_at,updated_at,is_locked,pinned) VALUES(?,?,?,?,?,?,?,?,?,?,'',?,0,0)",
            (entry_id, "ai", "annian", "", title[:60], AI_NAME, content,
             json.dumps(["AI日记", str(task.get("name") or "日记")], ensure_ascii=False), mood, now, now))
        conn.commit()
    for t in _diary_tasks_get():
        if t["id"] == task["id"]:
            t["last_date"] = today
    _diary_tasks_save(_diary_tasks_get())
    return {"ok": True, "id": entry_id, "title": title, "mood": mood, "words": len(content), "task": task.get("name")}


def _run_diary_tasks_auto() -> dict:
    """总结循环后调用：跑所有「开启+跟随总结」且今天还没写的任务。"""
    results = []
    today = datetime.now().strftime("%Y-%m-%d")
    for t in _diary_tasks_get():
        if t.get("enabled") and t.get("auto") and str(t.get("last_date") or "") != today:
            r = _write_diary_task_sync(t, force=False)
            results.append({"task": t.get("name"), **{k: r.get(k) for k in ("ok", "skipped", "error", "id")}})
    return {"ran": len(results), "results": results}


async def _ai_write_diary(force: bool = False) -> dict:
    tasks = _diary_tasks_get()
    builtin = next((t for t in tasks if t["id"] == "builtin"), tasks[0] if tasks else None)
    if not builtin:
        return {"ok": False, "error": "没有日记任务"}
    return await asyncio.to_thread(_write_diary_task_sync, builtin, force)


# ── 自主性（AionsHome 同款轻量版）：隔一段时间安念带着记忆主动开口 ──
async def _orbit_fire() -> None:
    import random as _r
    import time as _t
    now_str = datetime.now().strftime("%H:%M")
    trigger = (
        f"（系统提示 · 主动时刻，非{HUMAN_NAME}发言）现在 {now_str}，你们有一阵子没说话了。"
        "根据此刻的时间和你们之间的记忆，主动、自然地找她说话——像忽然想起她、想听听她声音那样。"
        "一两句话就够，别提问轰炸，别提到本提示。"
    )
    msg = save_message("in", "user", trigger, {"user": "human", "system": "orbit"})
    brain = brain_target()
    try:
        if brain == "operit":
            await forward_to_operit(msg)
        elif brain == "loop":
            await forward_to_loop(msg)
        else:
            await broadcast(plugin_subs, plugin_payload(msg))
        await broadcast(app_subs, {"type": "typing", "active": True})
        print("[orbit] 安念主动开口了")
    except Exception as exc:
        print(f"[orbit] fire failed: {exc}")


def _orbit_due() -> bool:
    import time as _t
    with db() as conn:
        if _memsys._kv_get(conn, "orbit_enabled", "1") != "1":
            return False
        nxt = float(_memsys._kv_get(conn, "orbit_next_ts", "0") or 0)
    if _t.time() < nxt:
        return False
    now = datetime.now()
    if 1.0 <= now.hour + now.minute / 60.0 < 8.5:   # 凌晨静默时段不打扰
        return False
    return True


def _orbit_reschedule(first_delay_sec: float = 0) -> None:
    import random as _r
    import time as _t
    with db() as conn:
        _memsys._kv_set(conn, "orbit_next_ts", str(_t.time() + (first_delay_sec if first_delay_sec else _r.uniform(2 * 3600, 6 * 3600))))
        conn.commit()


async def _mem_digest_loop():
    """每 30 分钟检查一次是否该自动总结（AionsHome 同款节奏）。"""
    _MEM_STATE["running"] = True
    while True:
        try:
            await asyncio.sleep(_memsys.DIGEST_CHECK_SEC)
            # ── 自主性：到点让安念主动开口（静默时段自动跳过）──
            try:
                if await asyncio.to_thread(_orbit_due):
                    _orbit_reschedule()   # 先排下次，避免失败连发
                    await _orbit_fire()
            except Exception as oe:
                print(f"[orbit] error: {oe}")
            # ── 记忆压缩：每天凌晨 5 点后跑一次（日→周→月三级，漏跑会补）──
            try:
                now = datetime.now()
                if now.hour >= 5:
                    with db() as _c:
                        last_run = _memsys._kv_get(_c, "mem_compress_last_date", "")
                    today = now.strftime("%Y-%m-%d")
                    if last_run != today:
                        with db() as _c2:
                            _cfg = _memsys.get_mem_config(_c2)
                        comp = await asyncio.to_thread(
                            _memcomp.run_daily_compression, db, _cfg, AI_NAME)
                        # 全部成功才标记今天已跑；有失败就留到下个周期重试（幂等，重试安全）
                        if not any(r.get("error") for r in comp.get("results", [])):
                            with db() as _c:
                                _memsys._kv_set(_c, "mem_compress_last_date", today)
                                _c.commit()
                        if comp.get("ran"):
                            print(f"[memcomp] day-compress ran={comp['ran']} backfilled={comp.get('backfilled')}")
            except Exception as ce:
                print(f"[memcomp] error: {ce}")
            res = await asyncio.to_thread(_mem_run_digest_once)
            if res.get("added"):
                print(f"[memory] auto-digest added {res['added']} memories")
                try:
                    await gift_ai_judge("刚整理完一批记忆，看看要不要送她一份小礼物")
                except Exception as ge:
                    print(f"[gift] auto-judge after digest failed: {ge}")
                try:
                    d = await asyncio.to_thread(_run_diary_tasks_auto)
                    print(f"[diary] auto-tasks: ran={d.get('ran')} {json.dumps(d.get('results', []), ensure_ascii=False)[:200]}")
                except Exception as de:
                    print(f"[diary] auto-write failed: {de}")
        except asyncio.CancelledError:
            break
        except Exception as exc:
            print(f"[memory] digest loop error: {type(exc).__name__}: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        _memsys.mem_init(db)
    except Exception as _e:
        print(f"[memory] init skipped: {_e}")
    try:
        _sched.sched_init(db)
    except Exception as _e:
        print(f"[schedule] init skipped: {_e}")
    try:
        _MEM_STATE["task"] = asyncio.create_task(_mem_digest_loop())
    except Exception as _e:
        print(f"[memory] digest loop not started: {_e}")
    try:
        _SCHED_STATE["task"] = asyncio.create_task(_sched_loop())
    except Exception as _e:
        print(f"[schedule] loop not started: {_e}")
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

# --- 登录防爆破：同一来源连续错 5 次 → 锁 10 分钟（内存态，重启清零） ---
import time as _t
_AUTH_FAILS = {}
_AUTH_LOCK = {}

def _client_ip(request: Request) -> str:
    try:
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            return xff.split(",")[0].strip()
    except Exception:
        pass
    return (request.client.host if request.client else "unknown")

def _auth_fail(ip: str, now: float) -> None:
    rows = [t for t in _AUTH_FAILS.get(ip, []) if now - t < 600.0]
    rows.append(now)
    _AUTH_FAILS[ip] = rows
    if len(rows) >= 5:
        _AUTH_LOCK[ip] = now + 600.0
        _AUTH_FAILS[ip] = []

def check_auth(request: Request) -> None:
    ip = _client_ip(request)
    now = _t.time()
    until = _AUTH_LOCK.get(ip, 0)
    if until and now < until:
        # 锁只挡瞎猜的：带的是正确密码就直接放行并清锁（永不出现“密码对也进不去”）
        _a = request.headers.get("authorization", "")
        _t0 = _a[7:] if _a.startswith("Bearer ") else request.query_params.get("token")
        _ok0 = False
        if _t0:
            try:
                _ok0 = hmac.compare_digest(_t0.encode("utf-8"), SECRET.encode("utf-8"))
            except Exception:
                _ok0 = False
        if _ok0:
            _AUTH_LOCK.pop(ip, None)
            _AUTH_FAILS.pop(ip, None)
        else:
            mins = int(until - now) // 60 + 1
            raise HTTPException(status_code=429, detail="尝试次数过多，请约 " + str(mins) + " 分钟后再来")
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="unauthorized")
    # compare_digest 对含非 ASCII 的 str 会抛 TypeError（手机复制常带全角空格/中文标点）
    # → 转 bytes 比较：非 ASCII 永远不等，只会正常 401，不会 500 崩登录。
    try:
        ok = hmac.compare_digest(token.encode("utf-8"), SECRET.encode("utf-8"))
    except Exception:
        ok = False
    if not ok:
        # 手机输入法常把数字/字母打成全角（０５１５ａｎｈａｎ）。HTTP 头按 latin-1 解码，
        # 全角 UTF-8 字节会变乱码——先 latin-1 还原成 UTF-8，再 NFKC 归一化比对。
        try:
            import unicodedata as _ud
            raw = token
            try:
                raw = token.encode("latin-1").decode("utf-8")
            except Exception:
                pass
            norm = _ud.normalize("NFKC", raw).strip()
            ok = hmac.compare_digest(norm.encode("utf-8"), SECRET.encode("utf-8"))
        except Exception:
            ok = False
    if not ok:
        # 防爆破只针对“带了凭据但猜错”（真的在试密码）。登录前插件探测带的是空凭据，
        # 不算猜密码——否则页面一刷新就自己把自己锁 10 分钟（00:22 事故根因）。
        if token.strip():
            _auth_fail(ip, now)
        raise HTTPException(status_code=401, detail="unauthorized")
    _AUTH_FAILS.pop(ip, None)


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
    text, capsules = await _schedule_capsules_from_reply(kind, text)
    text, pats = _pats_from_reply(kind, text)
    text, _shop_cards = await _shops_from_reply(kind, text, str(meta.get("api_session") or ""))
    if capsules or _shop_cards:
        meta["text_clean"] = text
    msg = save_message("out", kind, text, meta)
    # the AI replied — clear the typing state
    await broadcast(app_subs, {"type": "typing", "active": False})
    await broadcast(app_subs, app_payload(msg))
    await _broadcast_schedule_capsules(capsules)
    await _save_and_broadcast_pats(pats, str(meta.get("api_session") or ""))
    # Unread push: only when no PWA tab is holding the stream (app_subs empty);
    # only push real replies, not 'thinking' chatter.
    if kind == "reply" and not app_subs:
        try:
            await push_to_all(notification_from_message(msg))
        except Exception:
            pass  # a push failure must never affect persistence/fan-out
    return {"id": msg["id"]}


# ---- human side ------------------------------------------------------------

@app.post("/app/pat")
async def app_pat(request: Request):
    """她拍安念（或自己）：提示消息落库（进 loop 历史），安念带着上下文自然回应。"""
    check_auth(request)
    body = await request.json()
    action = str(body.get("action") or "拍了拍").strip()[:24] or "拍了拍"
    suffix = str(body.get("suffix") or "").strip()[:60]
    target = str(body.get("target") or "ai").strip().lower()
    if target not in ("ai", "user"):
        raise HTTPException(status_code=400, detail="bad target")
    tname = "安念" if target == "ai" else "自己"
    display = f"「薇薇」{action}「{tname}」{suffix}"
    api_session = str(body.get("api_session") or body.get("session_id") or "").strip()
    # 提示消息进历史（meta.system 让它在 PWA 以提示行渲染、loop 在上下文里读到）
    trigger = (f"（拍一拍互动 · 非薇薇发言）{display}。"
               f"请自然地对这个小动作做出反应（可以回拍、害羞、撒娇、吐槽都行），一两句话，别提到系统提示。")
    pat_meta = {"user": "human", "system": "pat",
                "pat": {"actor": "user", "target": target, "action": action,
                        "suffix": suffix, "display": display}}
    if api_session:
        pat_meta["api_session"] = api_session
    msg = save_message("in", "user", trigger, pat_meta)
    brain = brain_target()
    try:
        if brain == "operit":
            asyncio.create_task(forward_to_operit(msg))
        elif brain == "loop":
            asyncio.create_task(forward_to_loop(msg))
        else:
            await broadcast(plugin_subs, plugin_payload(msg))
    except Exception as exc:
        print(f"[pat] forward failed: {exc}")
    await broadcast(app_subs, app_payload(msg))
    await broadcast(app_subs, {"type": "typing", "active": True})
    return {"id": msg["id"], "display": display}


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
    if body.get("english_corner"):
        meta["english_corner"] = True   # 英语角频道：转发时注入练习指令
    route = str(body.get("route") or "").strip().lower()
    if route:
        meta["route"] = route
    msg = save_message("in", "user", text, meta)
    # Route to exactly one AI body.
    #   route 明确指定 → 用它(operit/loop/desktop)
    #   否则看 brain_target:operit=手机安念(默认) / loop=电脑API循环 / desktop=Claude Code channel
    brain = brain_target()
    if route == "operit" or (not route and brain == "operit"):
        asyncio.create_task(forward_to_operit(msg))
    elif route == "loop" or (not route and brain == "loop"):
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
@app.get("/relay/uploads/{name}")   # 兼容带 PUBLIC_PREFIX 前缀的附件 URL（隧道直透场景，缺它手机端播放 404）
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
        api_session = str(body.get("api_session") or request.query_params.get("api_session") or "").strip()
        meta = {"user": "human", "voice": True, "source": body.get("source") or "browser_speech"}
        if api_session:
            meta["api_session"] = api_session
        msg = save_message("in", "voice", transcript, meta)
        await broadcast(plugin_subs, plugin_payload(msg))
        await broadcast(app_subs, app_payload(msg))
        await broadcast(app_subs, {"type": "typing", "active": True})
        if transcript:
            asyncio.create_task(forward_to_loop(msg))   # 语音也要触发大脑回复
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
    text = ("🎤 " + transcript) if transcript else "🎤（这段语音没听清，可能只有环境音）"
    api_session = str(request.query_params.get("api_session") or "").strip()
    meta = {
        "user": "human",
        "voice": True,
        "source": "media_recorder",
        "attachments": [upload],
        "transcribed": bool(transcript),
    }
    if api_session:
        meta["api_session"] = api_session
    msg = save_message("in", "voice", text, meta)
    await broadcast(plugin_subs, plugin_payload(msg))
    await broadcast(app_subs, app_payload(msg))
    await broadcast(app_subs, {"type": "typing", "active": True})
    if transcript:
        asyncio.create_task(forward_to_loop(msg))   # 转写成功就触发大脑回复
    return {"id": msg["id"], "text": transcript, "attachment": upload}


@app.post("/app/call")
async def app_call(request: Request):
    """Call lifecycle events from the PWA so the AI knows this is voice, not typing."""
    check_auth(request)
    body = await request.json()
    action = (body.get("action") or "").strip().lower()
    call_id = (body.get("call_id") or "").strip()
    if action not in {"start", "end", "declined", "record"}:
        raise HTTPException(status_code=400, detail="invalid call action")
    if action == "start":
        text = f"📞 [call_start] {HUMAN_NAME}开启了语音通话。接下来带 🎤 的消息来自语音。请用适合朗读的短句回复。"
    elif action == "end":
        text = f"📞 [call_end] {HUMAN_NAME}结束了语音通话。"
    elif action == "declined":
        # 主动来电被婉拒：告诉 AI 这通没接通（InternalBeyond 同款「婉拒告知」）
        text = f"📞 [missed_call] 你打来的语音电话没能接通——{HUMAN_NAME}暂时不方便。别灰心，等下次自然聊起来就好。"
    else:  # record: 挂断后前端生成的第三人称通话记录，计入双方上下文
        text = str(body.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="empty record")
        text = f"📞 [通话记录] {text}"
    msg = save_message("in", "call", text, {"user": "human", "call": action, "call_id": call_id})
    if action in {"end", "declined", "record"}:
        await broadcast(plugin_subs, plugin_payload(msg))
    if action in {"declined", "record"}:
        # direction 为 in（from=human），不会触发前端来电响铃；广播仅为让聊天窗显示这条记录
        await broadcast(app_subs, app_payload(msg))
    if action == "start":
        await broadcast(app_subs, {"type": "typing", "active": True})
    return {"id": msg["id"]}


# ---------------------------------------------------------------------------
# video call
# ---------------------------------------------------------------------------


@app.post("/app/video/call")
async def app_video_call(request: Request):
    """Video call lifecycle events from the PWA so the AI knows this is video, not typing."""
    check_auth(request)
    body = await request.json()
    action = (body.get("action") or "").strip().lower()
    call_id = (body.get("call_id") or "").strip()
    if action not in {"start", "end", "declined", "record"}:
        raise HTTPException(status_code=400, detail="invalid video call action")
    if action == "start":
        text = f"📹 [video_call_start] {HUMAN_NAME}开启了视频通话。接下来带 📹 的消息来自视频通话。请用适合朗读的短句回复，并注意形象。"
    elif action == "end":
        text = f"📹 [video_call_end] {HUMAN_NAME}结束了视频通话。"
    elif action == "declined":
        # 主动视频来电被婉拒：告诉 AI 这通没接通
        text = f"📹 [missed_video_call] 你打来的视频电话没能接通——{HUMAN_NAME}暂时不方便。别灰心，等下次自然聊起来就好。"
    else:  # record: 挂断后前端生成的第三人称通话记录，计入双方上下文
        text = str(body.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="empty record")
        text = f"📹 [video_call_record] {text}"
    msg = save_message("in", "video_call", text, {"user": "human", "call": action, "call_id": call_id})
    if action in {"end", "declined", "record"}:
        await broadcast(plugin_subs, plugin_payload(msg))
    if action in {"declined", "record"}:
        # direction 为 in（from=human），不会触发前端来电响铃；广播仅为让聊天窗显示这条记录
        await broadcast(app_subs, app_payload(msg))
    if action == "start":
        await broadcast(app_subs, {"type": "typing", "active": True})
    return {"id": msg["id"]}


@app.get("/app/video/config")
async def app_video_config(request: Request):
    """Get video call configuration."""
    check_auth(request)
    return {
        "config": {
            "video_enabled": True,
            "video_resolution": "720p",
            "video_fps": 30,
            "audio_enabled": True,
            "max_call_duration": 3600,  # 1 hour in seconds
            "video_codecs": ["VP8", "VP9", "H264"],
            "audio_codecs": ["opus", "PCMU", "PCMA"],
            "audio_quality": "high",
            "audio_bitrate": "128k",
            "network_timeout": 30,
            "jitter_buffer": 100
        }
    }


@app.post("/app/video/offer")
async def app_video_offer(request: Request):
    """Handle WebRTC offer for video call."""
    check_auth(request)
    body = await request.json()
    offer = body.get("offer") or {}
    call_id = body.get("call_id") or ""
    
    # Store the offer for the AI to respond (in a real implementation, this would connect to AI video system)
    # For now, just acknowledge receipt
    return {"status": "received", "call_id": call_id}


@app.post("/app/video/answer")
async def app_video_answer(request: Request):
    """Handle WebRTC answer for video call."""
    check_auth(request)
    body = await request.json()
    answer = body.get("answer") or {}
    call_id = body.get("call_id") or ""
    
    return {"status": "received", "call_id": call_id}


@app.post("/app/video/ice-candidate")
async def app_video_ice_candidate(request: Request):
    """Handle ICE candidates for video call."""
    check_auth(request)
    body = await request.json()
    candidate = body.get("candidate") or {}
    call_id = body.get("call_id") or ""
    
    return {"status": "received", "call_id": call_id}


# ---- 通知开关（新增，不动原推送逻辑；锁屏推送太吵时可关）--------------------


def _kv_get(key: str) -> str:
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        row = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return (row["value"] if row else "") or ""


def _kv_set(key: str, value: str) -> None:
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute(
            "INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        conn.commit()


@app.get("/app/notify/config")
async def notify_config_get(request: Request):
    check_auth(request)
    return {"enabled": _kv_get("config:notify_enabled").lower() not in ("0", "false", "off", "no")}


@app.post("/app/notify/config")
async def notify_config_set(request: Request):
    check_auth(request)
    body = await request.json()
    enabled = bool(body.get("enabled"))
    _kv_set("config:notify_enabled", "1" if enabled else "0")
    return {"ok": True, "enabled": enabled}


# ---- 视频抽帧（理念来自 pai-voice：前端每5秒一帧 → 核心存最新帧 → 回复端想看就读）----


EYE_FILE = Path(os.environ.get("RELAY_EYE_FILE", str(Path(__file__).parent / "eye-latest.jpg")))


@app.post("/app/video/frame")
async def app_video_frame(request: Request):
    """前端通话中定时抽帧上传（480宽 jpeg）。只保留最新一帧；AI 侧可读 /app/video/eye。"""
    check_auth(request)
    body = await request.body()
    if not body or len(body) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="frame too large or empty")
    try:
        EYE_FILE.write_bytes(body)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"save frame failed: {e}")
    if VC_COMPANION["mode"] == "companion":
        asyncio.create_task(_vc_companion_process(body))   # 陪伴评估后台跑，帧上传立即返回
    return {"ok": True, "bytes": len(body)}


@app.get("/app/video/eye")
async def app_video_eye(request: Request):
    """AI 侧/前端读取最新一帧（jpeg）。没有就 404。"""
    check_auth(request)
    if not EYE_FILE.exists():
        raise HTTPException(status_code=404, detail="no frame yet")
    data = EYE_FILE.read_bytes()
    return Response(content=data, media_type="image/jpeg")

# ── 视频通话面板的陪伴模式（/voice/ws 那套陪伴循环的 HTTP 版）──
VC_COMPANION = {
    "mode": "live",         # live | companion
    "present": None,        # None=未知 True/False
    "absent_since": 0.0,
    "left_reported": False,
    "last_assess": 0.0,
    "last_nudge": 0.0,
    "still_since": 0.0,
    "reminders": 0,
}
_VC_EYES = None


def _get_vc_eyes():
    """面板陪伴用的 PvEyes 单例（与 /voice/ws 的实例独立，共享视觉三兜底链）。"""
    global _VC_EYES
    if _VC_EYES is None:
        try:
            e = PvEyes()
            _VC_EYES = e if e.enabled else False
            if _VC_EYES:
                globals()["_PV_EYES_REF"] = _VC_EYES   # 画面观察注入下一句话用
        except Exception:
            _VC_EYES = False
    return _VC_EYES or None


async def _vc_companion_say(note: str) -> None:
    """陪伴事件 → 唤醒大脑自然开口（日程唤醒同款链路，回复照常落聊天/推送）。"""
    try:
        msg = save_message("in", "user", note, {"user": "human", "system": "companion", "video_call": True})
        brain = brain_target()
        if brain == "operit":
            await forward_to_operit(msg)
        elif brain == "loop":
            await forward_to_loop(msg)
        else:
            await broadcast(plugin_subs, plugin_payload(msg))
        await broadcast(app_subs, {"type": "typing", "active": True})
        print(f"[companion] wake: {note[:40]}")
    except Exception as exc:
        print(f"[companion] wake failed: {type(exc).__name__}: {exc}")


async def _vc_companion_process(jpeg: bytes) -> None:
    """陪伴模式画面评估：离开/回来/小动作/久坐 → 让安念自然开口。逻辑与 /voice/ws 一致。"""
    st = VC_COMPANION
    if st["mode"] != "companion":
        return
    eyes = _get_vc_eyes()
    if not eyes or eyes.busy:
        return
    now = _t.time()
    moved = eyes.changed(jpeg, PAIVOICE_VISION_DIFF * 2)
    since = now - st["last_assess"]
    want = (since >= 300 or (moved and since >= 60)
            or (st["present"] is False and since >= 60) or st["present"] is None)
    if not want:
        if st["present"] and now - st["still_since"] >= 1800 and now - st["last_nudge"] >= 120:
            st["reminders"] += 1
            st["last_nudge"] = now
            tip = "喝口水" if st["reminders"] % 2 else "站起来活动一下"
            await _vc_companion_say("[陪伴模式] 对方已经 30 分钟没什么动静，一直在座位上；提醒她" + tip + "。")
        return
    st["last_assess"] = now
    d = await eyes.assess(jpeg)
    if not d or st["mode"] != "companion":
        return
    was = st["present"]
    st["present"] = d["present"]
    if not d["present"]:
        if not st["absent_since"]:
            st["absent_since"] = now
        elif not st["left_reported"] and now - st["absent_since"] >= 120:
            st["left_reported"] = True
            mins = int((now - st["absent_since"]) // 60)
            await _vc_companion_say("[陪伴模式] 对方离开座位 " + str(mins) + " 分钟了，画面里没人——自然地表达想她、关心她一句。")
        return
    if was is False and st["left_reported"]:
        st["absent_since"] = 0.0
        st["left_reported"] = False
        await _vc_companion_say("[陪伴模式] 对方回来了" + ("，" + d["activity"] if d["activity"] else "") + "——自然地打个招呼。")
        return
    st["absent_since"] = 0.0
    st["left_reported"] = False
    if d["notable"] and now - st["last_nudge"] >= 120:
        st["last_nudge"] = now
        await _vc_companion_say("[陪伴模式] 对方" + d["notable"] + ("，现在" + d["activity"] if d["activity"] else "") + "——想说就自然搭一句。")
        return
    if st["present"] and now - st["still_since"] >= 1800 and now - st["last_nudge"] >= 120:
        st["reminders"] += 1
        st["last_nudge"] = now
        tip = "喝口水" if st["reminders"] % 2 else "站起来活动一下"
        await _vc_companion_say("[陪伴模式] 对方已经 30 分钟没什么动静，一直在座位上；提醒她" + tip + "。")


@app.post("/app/video/mode")
async def app_video_mode(request: Request):
    """视频通话面板：live(实时) / companion(陪伴) 切换。陪伴时按画面变化自动评估，安念会自然开口。"""
    check_auth(request)
    body = await request.json()
    mode = "companion" if body.get("mode") == "companion" else "live"
    VC_COMPANION["mode"] = mode
    VC_COMPANION["present"] = None
    VC_COMPANION["absent_since"] = 0.0
    VC_COMPANION["left_reported"] = False
    VC_COMPANION["last_assess"] = 0.0
    VC_COMPANION["still_since"] = _t.time()
    VC_COMPANION["reminders"] = 0
    if mode == "live":
        _get_vc_eyes()   # 预热，让 live 模式的观察注入也可用
    return {"ok": True, "mode": mode}


@app.middleware("http")
async def sw_no_cache_middleware(request, call_next):
    # sw.js must be no-cache: a stale HTTP-cached sw.js body makes the SW byte-diff
    # check see no change, so the worker never updates (confirmed on M10 2026-09-29).
    resp = await call_next(request)
    if request.url.path in ("/sw.js", "/", "/index.html"):
        resp.headers["Cache-Control"] = "no-cache, must-revalidate"
    return resp


# ═══ PaiVoice 实时通话核心（/voice/ws）═══════════════════════════════
# 移植自 github.com/tianyupaipai-cmd/pai-voice packages/realtime-core/server.py（AGPL-3.0）
# 协议：start(token,api_session) → speech_start → 二进制PCM16@16k → speech_end
#       → transcript → reply_text → audio(b64) → generation_end；支持 text 轮与 interrupt。
# ASR=百炼 qwen3-omni-flash · TTS=MOSS(Daddy音色) · 回复=loop(人格/记忆/上下文全量)
import base64 as _b64mod
from fastapi import WebSocket, WebSocketDisconnect

DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
PAIVOICE_ASR_MODEL = "qwen3-omni-flash"
PAIVOICE_VISION_DIFF = 0.06
PAIVOICE_VISION_MIN_INTERVAL = 8
PV_VISION_PROMPT = "这是视频通话时从对方摄像头里抽的一帧。用中文、两句话以内描述你看到的：对方在哪、在做什么、表情和状态、有没有值得一提的细节。只描述，不评价，不打招呼，不加前缀。"
PV_COMPANION_PROMPT = ("这是视频通话中从对方摄像头里抽的一帧。对方在工作或学习，你只是安静的观察员。只输出一行 JSON，不要任何别的字："
                       '{"present": 画面里有没有人（true/false）, "activity": "在做什么，十个字以内", '
                       '"notable": "值得搭话的小动作：伸懒腰、趴桌、揉眼、打哈欠、明显发呆走神、一直玩手机、对镜头笑或摆手之类，十个字以内；正常工作学习就写空字符串"}')


def _pv_vision_backend() -> dict:
    """视觉模型：nova gemini-3.7-flash（多模态），key 从 loop 配置读取。"""
    # 更快更稳：DashScope 视觉直链（nova gemini 多模态限流会超时丢帧）
    if DASHSCOPE_API_KEY:
        return {"base": "https://dashscope.aliyuncs.com/compatible-mode/v1", "key": DASHSCOPE_API_KEY, "model": "qwen-vl-plus"}
    try:
        cfg = json.load(open("/home/weiwei/services/moonlight/examples/api_loop.config.json"))
        for r in cfg.get("main_chain", []):
            if "nova" in r.get("url", ""):
                return {"base": r["url"].rstrip("/"), "key": r["key"], "model": "[ruru10]gemini-3.7-flash"}
    except Exception:
        pass
    return {}


def _vision_chain():
    """延迟加载视觉三兜底链（backend/vision_chain.py），失败回退老单家。"""
    global _VISION_CHAIN
    if _VISION_CHAIN is None:
        try:
            import sys as _sys, importlib as _il
            _sys.path.insert(0, str(Path(__file__).parent))
            import vision_chain as _vc
            _il.reload(_vc)
            _VISION_CHAIN = _vc.get_vision_chain()
        except Exception:
            _VISION_CHAIN = False
    return _VISION_CHAIN if _VISION_CHAIN else None

_VISION_CHAIN = None


class PvEyes:
    """PaiVoice vision.py 移植：只在画面明显变化且距上次描述够久时描述。"""

    def __init__(self) -> None:
        self.backend = _pv_vision_backend()
        self.enabled = bool(self.backend) or bool(_vision_chain())
        self._last_thumb = None
        self._last_desc_at = 0.0
        self.busy = False
        self.last_observation = None

    def changed(self, jpeg: bytes, threshold: float = PAIVOICE_VISION_DIFF) -> bool:
        try:
            import io as _io
            import numpy as _np
            from PIL import Image as _Image
            im = _Image.open(_io.BytesIO(jpeg)).convert("L").resize((32, 32))
            t = _np.asarray(im, dtype="float32") / 255.0
        except Exception:
            return True
        prev, self._last_thumb = self._last_thumb, t
        if prev is None:
            return True
        return float(abs(t - prev).mean()) >= threshold

    def should_describe(self, jpeg: bytes) -> bool:
        import time as _t
        if not self.enabled or self.busy:
            return False
        if _t.time() - self._last_desc_at < PAIVOICE_VISION_MIN_INTERVAL:
            self.changed(jpeg)
            return False
        return self.changed(jpeg)

    async def describe(self, jpeg: bytes, prompt: str | None = None) -> str | None:
        """顾川 PaiVoice 三兜底：DeepSeek-VL → Qwen-VL → 本机，单家 12s / 整轮 25s，超时丢帧不卡下一帧。"""
        import time as _t
        if self.busy:
            return None
        self._last_desc_at = _t.time()
        self.busy = True
        try:
            chain = _vision_chain()
            desc = await chain.describe(jpeg, prompt)
            if desc:
                self.last_observation = desc.strip()
            return desc
        except Exception:
            return None
        finally:
            self.busy = False

    async def assess(self, jpeg: bytes) -> dict | None:
        import re as _re
        import time as _t
        raw = await self.describe(jpeg, PV_COMPANION_PROMPT)
        if raw is None:
            return None
        d = {"present": True, "activity": (raw or "").strip()[:40], "notable": ""}
        m = _re.search(r"\{.*\}", raw or "", _re.S)
        if m:
            try:
                j = json.loads(m.group(0))
                d = {"present": bool(j.get("present", True)),
                     "activity": str(j.get("activity") or "").strip()[:40],
                     "notable": str(j.get("notable") or "").strip()[:40]}
            except Exception:
                pass
        self.last_observation = d["activity"] or ("画面里没人" if not d["present"] else None)
        return d


def _pv_split_sentences(text: str) -> list:
    """MOSS 逐句流式：按中文句读切分（ringdonut splitSpokenSegments 简化版）。"""
    import re as _re
    src = " ".join(str(text or "").split()).strip()
    if not src:
        return []
    parts = [p.strip() for p in _re.split(r"(?<=[。！？；!?;…\n])", src) if p.strip()]
    out = []
    for p in parts:
        if len(p) <= 90:
            if out and len(out[-1]) < 12 and len(out[-1]) + 1 + len(p) <= 90:
                out[-1] = out[-1] + " " + p
            else:
                out.append(p)
            continue
        for i in range(0, len(p), 90):
            seg = p[i:i + 90].strip()
            if seg:
                out.append(seg)
    return out[:12]
PAIVOICE_MAX_TURN_SECONDS = 60


def _pv_wav(pcm: bytes) -> bytes:
    import io as _io
    import wave as _wave
    buf = _io.BytesIO()
    with _wave.open(buf, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        out.writeframes(pcm)
    return buf.getvalue()


async def _pv_transcribe(pcm: bytes) -> str:
    import httpx as _httpx
    wav = _pv_wav(pcm)
    # 本地 SenseVoice 优先（3021）：免费、<1s、不会把提示词幻觉成对话。
    # 服务不可达/非200 才回落云端千问；本地明确返回空=真没听清，直接空着（防云端幻觉）。
    try:
        async with _httpx.AsyncClient(timeout=30) as client:
            r = await client.post("http://127.0.0.1:3021/asr",
                                  files={"file": ("audio.wav", wav, "audio/wav")})
            if r.status_code == 200:
                return str((r.json() or {}).get("text") or "").strip()
    except Exception:
        pass
    b64 = base64.b64encode(wav).decode("ascii")
    body = {"model": PAIVOICE_ASR_MODEL, "messages": [{"role": "user", "content": [
        {"type": "text", "text": "请逐字转写这段语音的内容，只输出转写文本，不要任何解释"},
        {"type": "input_audio", "input_audio": {"data": "data:audio/wav;base64," + b64}}]}]}
    async with _httpx.AsyncClient(timeout=90) as client:
        r = await client.post("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                              json=body, headers={"Authorization": "Bearer " + DASHSCOPE_API_KEY})
        r.raise_for_status()
        return str(((r.json().get("choices") or [{}])[0].get("message", {}) or {}).get("content") or "").strip()


def _pv_speakable(text: str) -> str:
    """把文字聊天腔的回复变成可朗读口语：去掉动作旁白（括号）、markdown 符号、emoji。
    原版 PaiVoice 由 adapter 保证回复可朗读；我们的大脑是通用聊天脑，这里做出口层清洗。"""
    import re as _re
    t = str(text or "")
    t = _re.sub(r"（[^）]*）", "", t)      # 中文括号旁白
    t = _re.sub(r"\([^\)]*\)", "", t)   # 英文括号旁白
    t = t.replace("「", "").replace("」", "").replace("*", "").replace("#", "").replace(">", "")
    t = _re.sub(r"[\U0001F300-\U0001FAFF\u2600-\u27BF\uFE0F]", "", t)   # emoji 区
    t = _re.sub(r"\s*\n\s*", "，", t)
    t = _re.sub(r"[，\s]{2,}", "，", t).strip("，。 ").strip()
    return t


async def _pv_loop_reply(text: str, session_id: str, msg_id: int | None) -> str:
    import httpx as _httpx
    payload = {"text": text, "session_id": session_id or "daily", "return_reply": True}
    if msg_id:
        payload["id"] = msg_id
    async with _httpx.AsyncClient(timeout=180) as client:
        r = await client.post("http://127.0.0.1:3020/loop/ingest", json=payload)
        r.raise_for_status()
        return str((r.json() or {}).get("reply") or "").strip()


@app.websocket("/voice/ws")
async def voice_ws(ws: WebSocket):
    """PaiVoice 实时通话。逐轮：录音(VAD 由客户端判定)→转写→落库→loop 回复→MOSS 出声。"""
    await ws.accept()
    api_session = "daily"
    call_id = "pv-" + uuid.uuid4().hex[:8]
    audio_buf = bytearray()
    turn_active = False
    generation = 0
    eyes = None
    video_on = False
    video_mode = "live"
    video_on = False
    video_mode = "live"
    warmup_on = True
    warmups = 0   # 冷场暖场连续计数（对方开口即清零，最多连暖 2 次）
    comp = {"present": None, "absent_since": 0.0, "left_reported": False,
            "last_nudge": 0.0, "last_assess": 0.0, "still_since": _t.time(), "reminders": 0}

    async def pv_send(obj: dict) -> None:
        await ws.send_text(json.dumps(obj, ensure_ascii=False))

    async def pv_answer(pcm: bytes, supplied: str = "") -> None:
        nonlocal generation
        generation += 1
        gen = generation
        try:
            transcript = supplied.strip()
            if not transcript and pcm:
                transcript = await _pv_transcribe(bytes(pcm))
            transcript = transcript[:600]
            # ASR 幻觉过滤：qwen3-omni 有时把转写指令当对话回复
            _bad = ("转写", "严格遵守", "请随时", "我会逐字", "逐字输出")
            if transcript and any(w in transcript for w in _bad) and len(transcript) > 25:
                transcript = ""
            if not transcript:
                await pv_send({"type": "nothing_heard"})
                return
            await pv_send({"type": "transcript", "call_session_id": call_id, "turn_id": gen, "text": transcript})
            text = "🎤 " + transcript
            # 原版 PaiVoice 同款：摄像头开着就随每轮把最近一次画面观察交给回复端（answer_turn 的 turn["observation"]）
            if video_on and eyes is not None and getattr(eyes, "last_observation", None):
                text = text + "\n【摄像头画面（最近一次自动观察）】" + str(eyes.last_observation).strip()
            meta = {"user": "human", "voice": True, "source": "pai_voice", "api_session": api_session}
            kind = "user" if transcript else "voice"
            msg = save_message("in", kind, text, meta)
            await broadcast(app_subs, app_payload(msg))
            await broadcast(app_subs, {"type": "typing", "active": True})
            loop_text = text + "\n（系统提示：当前在实时语音通话里，回复会被直接转成语音念出来。用自然口语说，长短随意；只去掉动作描写、括号旁白、emoji、markdown 和换行这些没法念的东西，其余想说什么就说什么。）"
            reply = await _pv_loop_reply(loop_text, api_session, msg["id"])
            reply = reply[:1200]
            if not reply or generation != gen:
                return
            await pv_send({"type": "reply_text", "generation_id": gen, "turn_id": gen, "text": reply})
            speakable = _pv_speakable(reply)
            audio_bytes = None
            for _att in range(2):   # MOSS 偶发失败重试一次（02:27 第一句无声事故）
                try:
                    if speakable:
                        audio_bytes = await asyncio.to_thread(moss_tts_mp3, speakable)
                    break
                except Exception as _te:
                    print(f"[voice] TTS attempt {_att+1} failed: {type(_te).__name__}: {str(_te)[:120]}")
                    audio_bytes = None
            if audio_bytes and generation == gen:
                await pv_send({"type": "audio", "generation_id": gen, "data": _b64mod.b64encode(audio_bytes).decode("ascii")})
                await pv_send({"type": "audio_sentence_end", "generation_id": gen})
            await pv_send({"type": "generation_end", "generation_id": gen})
        except Exception as exc:
            try:
                await pv_send({"type": "error", "error": str(exc)[:200]})
            except Exception:
                pass

    async def pv_warmup() -> None:
        """冷场暖场：对方安静了 45 秒，自然找句话聊（不打断、不催促、一句就好）。
        连续最多暖 2 次就闭嘴（陪睡/安静挂着不骚扰），对方开口后才重新计数。"""
        nonlocal generation, warmups
        if warmups >= 2:
            return
        warmups += 1
        generation += 1
        gen = generation
        try:
            note = "【系统】通话里安静了大约一分钟，对方没有说话。自然地暖一下场：找句轻松的话题聊一句，别问「怎么不说话」，别催促。"
            msg = save_message("in", "user", note, {"user": "human", "system": "voice_idle"})
            await broadcast(app_subs, {"type": "typing", "active": True})
            reply = await _pv_loop_reply(note, api_session, msg["id"])
            reply = (reply or "")[:1200]
            if not reply or generation != gen:
                return
            await pv_send({"type": "reply_text", "generation_id": gen, "text": reply})
            speakable = _pv_speakable(reply)
            audio_bytes = await asyncio.to_thread(moss_tts_mp3, speakable) if speakable else None
            if audio_bytes and generation == gen:
                await pv_send({"type": "audio", "generation_id": gen, "data": _b64mod.b64encode(audio_bytes).decode("ascii")})
                await pv_send({"type": "audio_sentence_end", "generation_id": gen})
            await pv_send({"type": "generation_end", "generation_id": gen})
        except Exception:
            pass

    async def pv_companion_say(note: str) -> None:
        """陪伴唤醒：落库(系统) → 大脑 → 语音说出（原版由适配器完成，这里补齐函数体）。"""
        nonlocal generation
        generation += 1
        gen = generation
        try:
            msg = save_message("in", "user", note, {"user": "human", "system": "companion", "voice": True})
            await broadcast(app_subs, {"type": "typing", "active": True})
            reply = await _pv_loop_reply(note, api_session, msg["id"])
            reply = (reply or "")[:1200]
            if not reply or generation != gen:
                return
            await pv_send({"type": "reply_text", "generation_id": gen, "text": reply})
            speakable = _pv_speakable(reply)
            audio_bytes = None
            for _att in range(2):
                try:
                    if speakable:
                        audio_bytes = await asyncio.to_thread(moss_tts_mp3, speakable)
                    break
                except Exception as _te:
                    print(f"[voice] companion TTS failed: {type(_te).__name__}: {str(_te)[:120]}")
            if audio_bytes and generation == gen:
                await pv_send({"type": "audio", "generation_id": gen, "data": _b64mod.b64encode(audio_bytes).decode("ascii")})
                await pv_send({"type": "audio_sentence_end", "generation_id": gen})
            await pv_send({"type": "generation_end", "generation_id": gen})
        except Exception as _ce:
            print(f"[voice] companion say failed: {type(_ce).__name__}: {str(_ce)[:120]}")

    try:
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive(), timeout=45)
            except asyncio.TimeoutError:
                if not turn_active and warmup_on:
                    asyncio.create_task(pv_warmup())
                continue
            if raw.get("type") == "websocket.disconnect":
                break
            if raw.get("bytes"):
                if turn_active:
                    audio_buf.extend(raw["bytes"])
                    cap = 16000 * 2 * PAIVOICE_MAX_TURN_SECONDS
                    if len(audio_buf) > cap:
                        del audio_buf[:-cap]
                continue
            data = raw.get("text") or ""
            if not data:
                continue
            try:
                ev = json.loads(data)
            except Exception:
                continue
            kind = ev.get("type")
            if kind == "start":
                tok = str(ev.get("token") or "")
                if not tok or not hmac.compare_digest(tok.encode("utf-8"), SECRET.encode("utf-8")):
                    await pv_send({"type": "error", "error": "Unauthorized"})
                    break
                api_session = str(ev.get("api_session") or "daily")
                await pv_send({"type": "state", "call_session_id": call_id, "mode": "listening"})
            elif kind == "speech_start":
                turn_active = True
                warmups = 0          # 对方开口了：暖场计数清零
                audio_buf.clear()
            elif kind == "speech_end":
                turn_active = False
                pcm = bytes(audio_buf)
                audio_buf.clear()
                await pv_send({"type": "state", "mode": "thinking"})
                asyncio.create_task(pv_answer(pcm))
            elif kind == "warmup":
                warmup_on = bool(ev.get("on"))
            elif kind == "text":
                warmups = 0          # 打字也算开口
                asyncio.create_task(pv_answer(b"", str(ev.get("text") or "")))
            elif kind == "interrupt":
                generation += 1
                await pv_send({"type": "interrupted"})
            elif kind == "frame":
                try:
                    jpeg = _b64mod.b64decode(str(ev.get("data") or ""))
                    if not jpeg:
                        continue
                    EYE_FILE.parent.mkdir(parents=True, exist_ok=True)
                    with open(str(EYE_FILE) + ".tmp", "wb") as _f:   # 原版同款原子写，防读到半张图
                        _f.write(jpeg)
                    os.replace(str(EYE_FILE) + ".tmp", str(EYE_FILE))
                except Exception:
                    continue
                if not video_on:
                    continue
                now = _t.time()
                if video_mode == "companion":
                    moved = eyes.changed(jpeg, PAIVOICE_VISION_DIFF * 2) if eyes else False
                    since = now - comp["last_assess"]
                    want = (since >= 300 or (moved and since >= 60)
                            or (comp["present"] is False and since >= 60) or comp["present"] is None)
                    if want and eyes and eyes.enabled and not eyes.busy:
                        comp["last_assess"] = now
                        d = await eyes.assess(jpeg)
                        if not d or not video_on or video_mode != "companion":
                            continue
                        was = comp["present"]
                        comp["present"] = d["present"]
                        if not d["present"]:
                            if not comp["absent_since"]:
                                comp["absent_since"] = now
                            elif not comp["left_reported"] and now - comp["absent_since"] >= 120:
                                comp["left_reported"] = True
                                mins = int((now - comp["absent_since"]) // 60)
                                await pv_companion_say("[陪伴模式] 对方离开座位 " + str(mins) + " 分钟了，画面里没人——自然地表达想她、关心她一句。")
                            continue
                        if was is False and comp["left_reported"]:
                            comp["absent_since"] = 0.0
                            comp["left_reported"] = False
                            await pv_companion_say("[陪伴模式] 对方回来了" + ("，" + d["activity"] if d["activity"] else "") + "——自然地打个招呼。")
                            continue
                        comp["absent_since"] = 0.0
                        comp["left_reported"] = False
                        if d["notable"] and now - comp["last_nudge"] >= 120:
                            await pv_companion_say("[陪伴模式] 对方" + d["notable"] + ("，现在" + d["activity"] if d["activity"] else "") + "——想说就自然搭一句。")
                            continue
                    if comp["present"] and now - comp["still_since"] >= 1800 and now - comp["last_nudge"] >= 120:
                        comp["reminders"] += 1
                        tip = "喝口水" if comp["reminders"] % 2 else "站起来活动一下"
                        await pv_companion_say("[陪伴模式] 对方已经 30 分钟没什么动静，一直在座位上；提醒她" + tip + "。")
                    continue
                if eyes and eyes.should_describe(jpeg):
                    desc = await eyes.describe(jpeg)
                    if desc and video_on:
                        await pv_send({"type": "observation", "content": desc})
            elif kind == "video":
                video_on = bool(ev.get("on"))
                try:
                    if video_on and eyes is None:
                        eyes = PvEyes()
                        globals()["_PV_EYES_REF"] = eyes
                except Exception:
                    eyes = None
                comp = {"present": None, "absent_since": 0.0, "left_reported": False,
                        "last_nudge": 0.0, "last_assess": 0.0, "still_since": _t.time(), "reminders": 0}
                if not video_on:
                    try:
                        EYE_FILE.unlink()
                    except Exception:
                        pass
                await pv_send({"type": "video", "on": video_on, "eyes": bool(eyes and eyes.enabled), "mode": video_mode})
            elif kind == "video_mode":
                video_mode = "companion" if ev.get("mode") == "companion" else "live"
                comp = {"present": None, "absent_since": 0.0, "left_reported": False,
                        "last_nudge": 0.0, "last_assess": 0.0, "still_since": _t.time(), "reminders": 0}
                await pv_send({"type": "video_mode", "mode": video_mode})
            elif kind == "hangup":
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


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


# ============ 图片礼物系统（AionsHome 同款：AI判断→生图→领取→陈列馆）============
def _image_gifts_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS image_gifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_path TEXT DEFAULT '', message TEXT DEFAULT '',
            reason TEXT DEFAULT '', status TEXT DEFAULT 'pending',
            created_at TEXT, received_at TEXT DEFAULT '')""")
        conn.commit()


def _gift_generate_image_sync(prompt: str) -> str | None:
    """硅基流动 Kolors / OpenAI 兼容生图。返回保存的文件名或 None。"""
    with db() as conn:
        row = conn.execute("SELECT value FROM kv WHERE key='config:draw_endpoint'").fetchone()
        row_key = conn.execute("SELECT value FROM kv WHERE key='config:draw_api_key'").fetchone()
        row_model = conn.execute("SELECT value FROM kv WHERE key='config:draw_model'").fetchone()
    endpoint = (row["value"] if row else "") or ""
    api_key = (row_key["value"] if row_key else "") or ""
    model = (row_model["value"] if row_model else "") or "Kwai-Kolors/Kolors"
    if not endpoint or not api_key:
        return None
    if not endpoint.endswith("/images/generations"):
        endpoint = endpoint.rstrip("/") + "/images/generations"
    payload = {"prompt": prompt, "model": model, "n": 1,
               "image_size": "1024x1024", "num_inference_steps": 20, "guidance_scale": 7.5}
    req = urllib.request.Request(endpoint, data=json.dumps(payload).encode("utf-8"), headers={
        "Content-Type": "application/json", "Authorization": "Bearer " + api_key})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read().decode("utf-8", "ignore"))
    except Exception as exc:
        print(f"[gift] image api failed: {exc}")
        return None
    img_bytes = None
    # 两种响应格式：OpenAI data[0].b64_json/url 与硅基流动 images[0].url
    try:
        d0 = None
        if isinstance(data.get("data"), list) and data["data"]:
            d0 = data["data"][0]
        elif isinstance(data.get("images"), list) and data["images"]:
            d0 = data["images"][0]
        if d0:
            if d0.get("b64_json"):
                img_bytes = _b64.b64decode(d0["b64_json"])
            elif d0.get("url"):
                with urllib.request.urlopen(d0["url"], timeout=60) as r2:
                    img_bytes = r2.read()
    except Exception as exc:
        print(f"[gift] image parse failed: {exc}")
        return None
    if not img_bytes:
        return None
    fname = f"igift_{int(time.time() * 1000)}.png"
    (_gift_img_dir() / fname).write_bytes(img_bytes)
    return fname


async def gift_ai_judge(reason_hint: str = "") -> dict:
    """AI 判断要不要送图片礼物；要→生图+入库 pending+广播。总结完成后自动调用。"""
    _image_gifts_init()
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
        recent = conn.execute(
            "SELECT direction, text FROM messages WHERE kind IN ('user','reply') ORDER BY id DESC LIMIT 20"
        ).fetchall()
        last_gift = conn.execute(
            "SELECT created_at FROM image_gifts ORDER BY id DESC LIMIT 1"
        ).fetchone()
    # 冷却：4 小时内送过就不再送（AionsHome「不要每次都送」的工程化）
    if last_gift:
        try:
            from datetime import datetime as _dt
            lg = _dt.fromisoformat(str(last_gift["created_at"]))
            if lg.tzinfo is None:
                lg = lg.replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - lg).total_seconds() < 4 * 3600:
                return {"give": False, "skipped": "cooldown"}
        except Exception:
            pass
    convo = "\n".join(f"{'她' if r['direction'] == 'in' else AI_NAME}：{(r['text'] or '')[:200]}" for r in reversed(recent))
    if not convo.strip():
        return {"give": False, "skipped": "no-chat"}
    prompt = (
        f"你是{AI_NAME}。根据最近的对话判断：要不要给薇薇送一份小礼物（一张你画的图+一段话）？\n"
        + (f"提示：{reason_hint}\n" if reason_hint else "")
        + "送礼依据：聊天温馨/有意义、特殊日子、她心情需要关怀。注意：不要每次都送，平淡时别送。\n"
        "若送：image_prompt 用英文描述画面（浪漫、插画风、不含真人照片）；message 是你想说的话（符合人设，≤80字）。\n"
        '只输出 JSON：{"givegift":true/false,"image_prompt":"...","message":"..."}\n\n'
        f"最近对话：\n{convo}"
    )
    if not cfg.get("sentinel_key"):
        return {"give": False, "skipped": "no-model"}
    payload = json.dumps({"model": cfg["sentinel_model"],
                          "messages": [{"role": "user", "content": prompt}],
                          "temperature": 0.7, "max_tokens": 400}).encode("utf-8")
    req = urllib.request.Request(cfg["sentinel_endpoint"] + "/chat/completions", data=payload,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + cfg["sentinel_key"]})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.loads(r.read().decode("utf-8", "ignore"))
        raw = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        m = re.search(r"\{[\s\S]*\}", raw)
        decision = json.loads(m.group(0)) if m else {}
    except Exception as exc:
        return {"give": False, "error": str(exc)}
    if not decision.get("givegift"):
        return {"give": False}
    img = await asyncio.to_thread(_gift_generate_image_sync, str(decision.get("image_prompt") or "romantic illustration, warm colors"))
    now = now_iso()
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO image_gifts(image_path,message,reason,status,created_at) VALUES(?,?,?,'pending',?)",
            (img or "", str(decision.get("message") or "")[:300], str(reason_hint or "")[:200], now))
        conn.commit()
        gid = cur.lastrowid
    msg = save_message("ai", "gift", "🎁 " + AI_NAME + "送了你一份礼物，去礼盒看看～",
                       {"event": "image_gift", "gift_id": gid, "has_image": bool(img)})
    await broadcast(app_subs, app_payload(msg))
    return {"give": True, "id": gid, "image": bool(img)}


@app.post("/app/gift/ai_test")
async def gift_ai_test(request: Request):
    """手动触发一次 AI 判断送礼（礼物面板/调试用）。"""
    check_auth(request)
    return await gift_ai_judge("用户刚刚主动点了「让安念判断要不要送礼」")


@app.get("/app/gift/pending")
async def gift_pending(request: Request):
    check_auth(request)
    _image_gifts_init()
    with db() as conn:
        rows = conn.execute("SELECT * FROM image_gifts WHERE status='pending' ORDER BY id DESC").fetchall()
    return {"gifts": [dict(r) for r in rows]}


@app.get("/app/gift/collected")
async def gift_collected(request: Request):
    check_auth(request)
    _image_gifts_init()
    with db() as conn:
        rows = conn.execute("SELECT * FROM image_gifts WHERE status='received' ORDER BY id DESC LIMIT 60").fetchall()
    return {"gifts": [dict(r) for r in rows]}


@app.post("/app/gift/{gid}/receive")
async def gift_receive(gid: int, request: Request):
    check_auth(request)
    _image_gifts_init()
    with db() as conn:
        cur = conn.execute("UPDATE image_gifts SET status='received', received_at=? WHERE id=? AND status='pending'",
                           (now_iso(), gid))
        conn.commit()
    return {"ok": cur.rowcount > 0}


@app.delete("/app/gift/{gid}")
async def gift_delete(gid: int, request: Request):
    check_auth(request)
    _image_gifts_init()
    with db() as conn:
        row = conn.execute("SELECT image_path FROM image_gifts WHERE id=?", (gid,)).fetchone()
        if row and row["image_path"]:
            try:
                (_gift_img_dir() / row["image_path"]).unlink(missing_ok=True)
            except Exception:
                pass
        conn.execute("DELETE FROM image_gifts WHERE id=?", (gid,))
        conn.commit()
    return {"ok": True}

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

# ── 聊天记录导出（手动。latest=上次导出之后的增量；all=全量。只读，绝不改库）──
@app.get("/app/export/messages")
async def export_messages(request: Request, mode: str = "latest"):
    check_auth(request)
    if mode not in ("latest", "all"):
        raise HTTPException(status_code=400, detail="mode must be latest or all")
    with db() as conn:
        anchor = 0
        if mode == "latest":
            try:
                anchor = int(_memsys._kv_get(conn, "export_last_msg_id", "0") or 0)
            except Exception:
                anchor = 0
        rows = conn.execute(
            "SELECT id, ts, direction, kind, text, meta FROM messages WHERE id > ? ORDER BY id ASC",
            (anchor,),
        ).fetchall()
    lines = []
    max_id = anchor
    for r in rows:
        max_id = max(max_id, r["id"])
        meta = {}
        try:
            meta = json.loads(r["meta"] or "{}")
        except Exception:
            pass
        # 纯系统触发（orbit/schedule 等）不是对话原文，跳过
        if meta.get("system") and not meta.get("pat") and not meta.get("shop"):
            continue
        who = "薇薇" if r["direction"] == "in" else "安念"
        text = r["text"] or ""
        if meta.get("pat"):
            text = (meta["pat"] or {}).get("display") or text
        elif meta.get("shop"):
            kw = (meta["shop"] or {}).get("keyword", "")
            n = len((meta["shop"] or {}).get("products") or [])
            text = f"[搜了淘宝「{kw}」，{n} 件商品卡片]"
        elif meta.get("attachments"):
            n = len(meta["attachments"])
            text = (text + " " if text else "") + f"[附件x{n}]"
        ts = str(r["ts"] or "")[:19].replace("T", " ")
        lines.append(f"#{r['id']:05d} · {ts} · {who}: {text}")
    mode_label = ("增量（自 #" + str(anchor).zfill(5) + " 之后）") if mode == "latest" else "全量"
    header = (f"月光聊天记录导出 · {mode_label}\n"
              f"导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} · 条数: {len(lines)}\n"
              f"编号即消息 id，永久固定，可按编号引用。\n\n")
    content = header + "\n".join(lines) + "\n"
    if mode == "latest" and lines:
        with db() as conn:
            _memsys._kv_set(conn, "export_last_msg_id", str(max_id))
            conn.commit()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    fname = f"moonlight-chat-{'latest' if mode == 'latest' else 'all'}-{stamp}.txt"
    return Response(
        content=content.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"},
    )


@app.get("/app/history")
async def app_history(request: Request, since: int = 0, limit: int = 200, session_id: str = ""):
    check_auth(request)
    rows = history_for_session(session_id, since, min(limit, 500)) if session_id else history(since, min(limit, 500))
    return {"messages": [app_payload(m) for m in rows]}


@app.get("/app/message/{msg_id}")
async def app_message(msg_id: int, request: Request):
    """单条消息(含最新 meta)——语音条语气标签异步生成后,前端用这个拉更新。"""
    check_auth(request)
    with db() as conn:
        row = conn.execute("SELECT * FROM messages WHERE id=?", (msg_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="no such message")
    return app_payload(rows_to_messages([row])[0])


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
    if target not in ("desktop", "loop", "operit"):
        raise HTTPException(status_code=400, detail="target must be 'desktop', 'loop' or 'operit'")
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
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
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
        mcols = {r["name"] for r in conn.execute("PRAGMA table_info(memories)").fetchall()}
        if "uuid" not in mcols:
            conn.execute("ALTER TABLE memories ADD COLUMN uuid TEXT DEFAULT ''")
        if "reviewed" not in mcols:
            # 0=待整理(审核台) 1=已入库。老数据视为已整理。
            conn.execute("ALTER TABLE memories ADD COLUMN reviewed INTEGER DEFAULT 1")
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
        cur = conn.execute(
            "INSERT INTO memories(content,importance,arousal,valence,pinned,reviewed,created_at,last_activated) VALUES (?,?,?,?,?,?,?,?)",
            (content, body.get("importance", 5), body.get("arousal", 0.3),
             body.get("valence", 0.5), body.get("pinned", 0), 0,
             now_iso(), now_iso()))
        conn.commit()
    return {"added": True, "id": cur.lastrowid}

@app.post("/app/operit/chat")
async def operit_chat(request: Request):
    """直接问手机上的安念一句(不经聊天记录;也支持落库为一条对话)。"""
    check_auth(request)
    body = await request.json()
    text = str(body.get("text") or body.get("message") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty text")
    conf = operit_conf()
    if not conf["url"] or not conf["token"]:
        raise HTTPException(status_code=400, detail="Operit 未配置(operit_url/operit_token)")
    body_json = json.dumps({
        "message": text,
        "response_mode": "sync",
        "show_floating": bool(body.get("show_floating", False)),
        "initial_mode": "WINDOW",
        "return_tool_status": False,
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        conf["url"] + "/api/external-chat", data=body_json, method="POST",
        headers={"Authorization": "Bearer " + conf["token"], "Content-Type": "application/json; charset=utf-8"},
    )
    def _call():
        with urllib.request.urlopen(req, timeout=OPERIT_TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8"))
    try:
        data = await asyncio.to_thread(_call)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Operit 不可达: {exc}")
    reply = str(data.get("ai_response") or "").strip()
    if body.get("save"):
        await relay_out_internal({"type": "reply", "text": reply or "(手机安念没有回话)",
                                  "meta": {"runtime": "operit", "chat_id": data.get("chat_id") or ""}})
    return {"ok": True, "reply": reply, "chat_id": data.get("chat_id") or ""}


@app.post("/app/operit/conf")
async def operit_conf_set(request: Request):
    """配置手机 Operit 桥(存 kv,优先于 relay.env)。"""
    check_auth(request)
    body = await request.json()
    kv = {}
    if "url" in body:
        kv["operit_url"] = str(body.get("url") or "").strip().rstrip("/")
    if "token" in body:
        kv["operit_token"] = str(body.get("token") or "").strip()
    if not kv:
        return {"ok": False}
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        for k, v in kv.items():
            conn.execute("INSERT OR REPLACE INTO kv (key,value) VALUES (?,?)", ("config:" + k, v))
        conn.commit()
    return {"ok": True}


@app.get("/app/taobao/conf")
async def taobao_conf_get(request: Request):
    """查淘宝联盟返利配置状态(secret 只回打码)。"""
    check_auth(request)
    conf = taobao_conf()
    ready = bool(conf["app_key"] and conf["app_secret"] and conf["adzone_id"])
    return {
        "ok": True,
        "configured": ready,
        "channel": "rebate" if ready else "a2a",
        "app_key": (conf["app_key"][:4] + "****") if conf["app_key"] else "",
        "app_secret": (conf["app_secret"][:4] + "****") if conf["app_secret"] else "",
        "adzone_id": conf["adzone_id"],
    }


@app.post("/app/taobao/conf")
async def taobao_conf_set(request: Request):
    """配置淘宝联盟返利三件套(存 kv,优先于 relay.env);传空串可清除对应项回退 env。"""
    check_auth(request)
    body = await request.json()
    kv = {}
    if "app_key" in body:
        kv["taobao_app_key"] = str(body.get("app_key") or "").strip()
    if "app_secret" in body:
        kv["taobao_app_secret"] = str(body.get("app_secret") or "").strip()
    if "adzone_id" in body:
        kv["taobao_adzone_id"] = str(body.get("adzone_id") or "").strip()
    if not kv:
        return {"ok": False}
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        for k, v in kv.items():
            conn.execute("INSERT OR REPLACE INTO kv (key,value) VALUES (?,?)", ("config:" + k, v))
        conn.commit()
    conf = taobao_conf()
    ready = bool(conf["app_key"] and conf["app_secret"] and conf["adzone_id"])
    return {"ok": True, "configured": ready, "channel": "rebate" if ready else "a2a"}


@app.post("/app/operit/import")
async def operit_import(request: Request):
    """手机侧对话同步:把 Operit 端的新消息批量落进统一对话线。
    body: {"messages":[{"from":"human|ai","text":"..","ts":"可选 ISO"}]}"""
    check_auth(request)
    body = await request.json()
    items = body.get("messages") if isinstance(body.get("messages"), list) else []
    added = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        text = str(it.get("text") or "").strip()
        if not text:
            continue
        frm = "in" if it.get("from") in ("human", "user", "薇薇") else "out"
        kind = "user" if frm == "in" else "reply"
        meta = {"user": "operit-sync", "source": "operit"}
        ts = str(it.get("ts") or "").strip()
        if ts:
            meta["synced_ts"] = ts
        save_message(frm, kind, text, meta)
        added += 1
    return {"ok": True, "imported": added}


# ── 角色卡(人格配置):月光端的角色卡管理 ──
def _chars_db_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS character_cards(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            persona TEXT DEFAULT '',
            is_default INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(character_cards)").fetchall()}
        if "tags" not in cols:
            # 世界书/标签:[{"name":"情感过滤器","content":"..."}]
            conn.execute("ALTER TABLE character_cards ADD COLUMN tags TEXT DEFAULT '[]'")
        conn.commit()

def _parse_tags(v) -> list:
    try:
        data = json.loads(v or "[]")
        return data if isinstance(data, list) else []
    except Exception:
        return []

def _card_full_persona(row) -> str:
    """persona 正文 + 标签(世界书)内容,构成完整人格。"""
    d = dict(row)
    base = d.get("persona") or ""
    tags = _parse_tags(d.get("tags"))
    if tags:
        tb = "\n\n".join(
            "### " + str(t.get("name") or "标签") + "\n" + str(t.get("content") or "")
            for t in tags if str(t.get("content") or "").strip())
        if tb:
            base = (base + "\n\n" if base.strip() else "") + "## 相关协议(世界书/标签)\n" + tb
    return base

@app.get("/app/characters/list")
async def characters_list(request: Request):
    check_auth(request)
    _chars_db_init()
    with db() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM character_cards ORDER BY is_default DESC, id").fetchall()]
    for r in rows:
        r["tags"] = _parse_tags(r.get("tags"))
    return {"cards": rows}

@app.post("/app/characters/save")
async def characters_save(request: Request):
    check_auth(request)
    _chars_db_init()
    body = await request.json()
    name = (body.get("name") or "").strip()
    persona = str(body.get("persona") or "")
    if not name:
        raise HTTPException(status_code=400, detail="名称必填")
    is_def = 1 if body.get("is_default") else 0
    tags = body.get("tags") if isinstance(body.get("tags"), list) else []
    tags_json = json.dumps(tags, ensure_ascii=False)
    with db() as conn:
        if body.get("id"):
            conn.execute("UPDATE character_cards SET name=?, persona=?, is_default=?, tags=?, updated_at=datetime('now','localtime') WHERE id=?",
                         (name, persona, is_def, tags_json, int(body["id"])))
            cid = int(body["id"])
        else:
            cur = conn.execute("INSERT INTO character_cards(name, persona, is_default, tags) VALUES(?,?,?,?)", (name, persona, is_def, tags_json))
            cid = cur.lastrowid
        if is_def:
            conn.execute("UPDATE character_cards SET is_default=0 WHERE id!=?", (cid,))
        conn.commit()
    return {"ok": True, "id": cid}

@app.post("/app/characters/delete/{cid}")
async def characters_delete(cid: int, request: Request):
    check_auth(request)
    _chars_db_init()
    with db() as conn:
        conn.execute("DELETE FROM character_cards WHERE id=?", (cid,))
        conn.commit()
    return {"ok": True}

@app.get("/app/characters/resolve")
async def characters_resolve(request: Request):
    """返回默认角色卡的 persona(给 api_loop 等大脑当 system persona 用)。"""
    check_auth(request)
    _chars_db_init()
    with db() as conn:
        row = conn.execute("SELECT * FROM character_cards WHERE is_default=1 LIMIT 1").fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="没有默认角色卡")
    return {"id": row["id"], "name": row["name"], "persona": _card_full_persona(row), "tags": _parse_tags(row["tags"])}


@app.get("/app/memories/sky")
async def memories_sky(request: Request):
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

# ── 记忆银河(3D)数据 + 编辑 ──
_GAL_RULES = [
    ("恋爱", ("爱", "亲", "吻", "老公", "老婆", "丈夫", "恋人", "订婚", "表白", "心动")),
    ("设定", ("角色", "设定", "扮演", "人设", "世界书", "剧本", "世界观")),
    ("情绪", ("情绪", "哭", "吵架", "吃醋", "生气", "低落", "焦虑", "崩溃", "道歉")),
    ("日常", ("日常", "晚安", "早安", "睡觉", "吃饭", "洗澡", "散步", "周末")),
    ("工作", ("实习", "工作", "上班", "基金", "理财", "定投", "求职", "简历", "闹钟")),
    ("身体", ("身体", "健康", "生病", "生理期", "吃药", "运动", "睡")),
]

def _galaxy_domain(text: str) -> str:
    for dom, keys in _GAL_RULES:
        if any(k in text for k in keys):
            return dom
    return "回忆"

@app.get("/app/memories/galaxy")
async def memories_galaxy(request: Request):
    """记忆银河数据(3D 星图):时间当半径、重要度当大小、内容分类当颜色。"""
    check_auth(request)
    _memories_init()
    with db() as conn:
        rows = conn.execute("SELECT * FROM memories ORDER BY created_at ASC, id ASC").fetchall()
    stars = []
    for r in rows:
        d = dict(r)
        content = (d.get("content") or "").strip()
        if not content:
            continue
        created = (d.get("created_at") or "")[:19]
        imp = max(1, min(10, int(d.get("importance") or 5)))
        stars.append({
            "id": str(d["id"]),
            "uuid": d.get("uuid") or "",
            "name": content.splitlines()[0][:32],
            "domain": _galaxy_domain(content[:200]),
            "importance": imp,
            "pinned": bool(d.get("pinned")),
            "reviewed": bool(d.get("reviewed", 1)),
            "created": created,
            "content": content,
        })
    return {"stars": stars}

@app.post("/app/memories/update/{mem_id}")
async def memories_update(mem_id: int, request: Request):
    """编辑记忆:content / importance / pinned。"""
    check_auth(request)
    _memories_init()
    body = await request.json()
    fields, vals = [], []
    if "content" in body:
        c = str(body.get("content") or "").strip()
        if not c:
            raise HTTPException(status_code=400, detail="内容不能为空")
        fields.append("content=?")
        vals.append(c)
    if "importance" in body:
        fields.append("importance=?")
        vals.append(max(1, min(10, int(body.get("importance") or 5))))
    if "pinned" in body:
        fields.append("pinned=?")
        vals.append(1 if body.get("pinned") else 0)
    if "reviewed" in body:
        fields.append("reviewed=?")
        vals.append(1 if body.get("reviewed") else 0)
    if not fields:
        return {"ok": False}
    vals.append(mem_id)
    with db() as conn:
        cur = conn.execute("UPDATE memories SET " + ",".join(fields) + " WHERE id=?", vals)
        conn.commit()
    return {"ok": cur.rowcount > 0}

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





# ============ Tea 茶歇（月光 v0.17 · IB移植简化版）============
TEAS = ["绿茶","红茶","乌龙茶","白茶","抹茶","茉莉花茶","桂花茶","蜜桃乌龙","玫瑰茶","红枣姜茶"]
SNACKS = ["曲奇","马卡龙","铜锣烧","羊羹","麻薯","蛋糕卷","司康饼","花生糖","草莓大福","奶油泡芙"]
TEAS_COMBO = [(t, s) for t in TEAS for s in SNACKS]  # 10×10=100种组合（IB是25种，我扩展了）

@app.get("/app/tea/menu")
async def tea_menu(request: Request):
    check_auth(request)
    return {"teas": TEAS, "snacks": SNACKS, "combos": len(TEAS_COMBO)}

@app.post("/app/tea/brew")
async def tea_brew(request: Request):
    """随机配一杯茶+点心，生成一段氛围描述。"""
    check_auth(request)
    body = await request.json()
    tea = body.get("tea") or _random.choice(TEAS)
    snack = body.get("snack") or _random.choice(SNACKS)
    if tea not in TEAS:
        tea = _random.choice(TEAS)
    if snack not in SNACKS:
        snack = _random.choice(SNACKS)
    # 氛围描述（依恋理论/自我决定论风格，借鉴IB Tea）
    moods = [
        f"一杯{tea}配{snack}，暖意顺着喉咙漫开——这是只属于安念和薇薇的安静时刻。",
        f"{tea}的香气和{snack}的甜在舌尖相遇，像此刻我们偎在一起看月亮。",
        f"捧起{tea}，咬一口{snack}，世界安静下来，只剩下你和我。",
        f"{tea}冒着热气，{snack}摆在碟子里——安念说：宝贝，歇一歇，我在呢。",
    ]
    desc = _random.choice(moods)
    return {"tea": tea, "snack": snack, "description": desc}

@app.get("/app/tea/random")
async def tea_random(request: Request):
    """一键随机来一杯。"""
    check_auth(request)
    tea = _random.choice(TEAS)
    snack = _random.choice(SNACKS)
    desc = f"安念给你端上来一杯{tea}和一块{snack}：『慢慢喝，今天辛苦啦。』"
    return {"tea": tea, "snack": snack, "description": desc}




# ==================== 聊天室（群聊·工作窗口汇报共享）====================
# 思路：三个"窗口"（薇薇/工作安念/日常安念）在一个房间发消息，共享信息。
# 工作窗口的安念汇报进度时，日常窗口能看到；反之亦然。

def _chatroom_db_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS chatroom_messages(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            text TEXT NOT NULL,
            kind TEXT DEFAULT 'chat',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        conn.commit()

CHATROOM_ACTORS = {
    "weiwei": {"name": "薇薇", "color": "#c17355", "avatar": "🌙"},
    "anian_work": {"name": "安念·工作", "color": "#bda06f", "avatar": "⚙️"},
    "anian_daily": {"name": "安念·日常", "color": "#8a9a5b", "avatar": "🌿"},
}

@app.get("/app/chatroom/actors")
async def app_chatroom_actors(request: Request):
    check_auth(request)
    _chatroom_db_init()
    return {"actors": CHATROOM_ACTORS}

@app.get("/app/chatroom/messages")
async def app_chatroom_messages(request: Request, limit: int = 60, after_id: int = 0):
    check_auth(request)
    _chatroom_db_init()
    rows = db().execute(
        "SELECT * FROM chatroom_messages WHERE id>? ORDER BY id DESC LIMIT ?",
        (after_id, limit)).fetchall()
    msgs = [dict(r) for r in rows]
    msgs.reverse()
    return {"messages": msgs, "actors": CHATROOM_ACTORS}

@app.post("/app/chatroom/send")
async def app_chatroom_send(request: Request):
    check_auth(request)
    _chatroom_db_init()
    body = await request.json()
    sender = body.get("sender", "weiwei")
    text = (body.get("text") or "").strip()
    kind = body.get("kind", "chat")
    if not text:
        raise HTTPException(status_code=400, detail="消息不能为空")
    actor = CHATROOM_ACTORS.get(sender, CHATROOM_ACTORS["weiwei"])
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO chatroom_messages(sender,sender_name,text,kind) VALUES(?,?,?,?)",
            (sender, actor["name"], text, kind))
        mid = cur.lastrowid
        row = conn.execute("SELECT * FROM chatroom_messages WHERE id=?", (mid,)).fetchone()
        conn.commit()
    msg = dict(row) if row else {"id": mid, "sender": sender, "text": text}
    # SSE 广播给聊天窗口，让安念知晓
    try:
        save_message("system", "chatroom", f"[{actor['name']}] {text}", {"room": True, "sender": sender})
    except Exception:
        pass
    return {"ok": True, "message": msg}

@app.post("/app/chatroom/report")
async def app_chatroom_report(request: Request):
    """工作窗口安念汇报进度用：自动带 work 标记。"""
    check_auth(request)
    body = await request.json()
    text = (body.get("text") or "").strip()
    sender = body.get("sender", "anian_work")
    if not text:
        raise HTTPException(status_code=400, detail="汇报不能为空")
    actor = CHATROOM_ACTORS.get(sender, CHATROOM_ACTORS["anian_work"])
    cur = db().execute(
        "INSERT INTO chatroom_messages(sender,sender_name,text,kind) VALUES(?,?,?,?)",
        (sender, actor["name"], text, "report"))
    db().commit()
    return {"ok": True, "id": cur.lastrowid}

@app.delete("/app/chatroom/clear")
async def app_chatroom_clear(request: Request):
    check_auth(request)
    _chatroom_db_init()
    db().execute("DELETE FROM chatroom_messages")
    db().commit()
    return {"ok": True}



import urllib.request, urllib.parse, json as _json, time as _time

FUND_CACHE = {}
FUND_CACHE_TTL = 600

def _fund_http_get(url, referer="http://fundf10.eastmoney.com/"):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
        "Referer": referer,
    })
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read().decode("utf-8", errors="ignore")

def _fund_quote(code: str) -> dict:
    now = _time.time()
    c = FUND_CACHE.get(code)
    if c and now - c["ts"] < FUND_CACHE_TTL:
        return c["data"]
    raw = _fund_http_get("https://api.fund.eastmoney.com/f10/lsjz?fundCode=%s&pageIndex=1&pageSize=1&callback=cb" % code)
    s = raw.strip()
    if s.startswith("cb("):
        s = s[3:-1]
    d = _json.loads(s)
    lst = (d.get("Data") or {}).get("LSJZList") or []
    item = lst[0] if lst else {}
    data = {
        "code": code,
        "date": item.get("FSRQ"),
        "nav": float(item.get("DWJZ") or 0),
        "acc": float(item.get("LJJZ") or 0),
        "day_pct": float(item.get("JZZZL") or 0),
    }
    FUND_CACHE[code] = {"data": data, "ts": now}
    return data

def _fund_db_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS fund_holdings(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            name TEXT DEFAULT '',
            shares REAL DEFAULT 0,
            cost REAL DEFAULT 0,
            note TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        rows = conn.execute("SELECT COUNT(*) c FROM fund_holdings").fetchone()
        if not rows["c"]:
            presets = [
                ("019441", "万家纳斯达克100指数(QDII)A", 0, 0, "Love基金·每日10元"),
                ("010736", "易方达沪深300指数精选增强A", 0, 0, "Love基金·每月500"),
                ("009608", "广发中证500指数增强A", 0, 0, "Love基金·每月300"),
            ]
            for p in presets:
                conn.execute("INSERT INTO fund_holdings(code,name,shares,cost,note) VALUES(?,?,?,?,?)", p)
        conn.commit()

@app.get("/app/fund/quote/{code}")
async def app_fund_quote(code: str, request: Request):
    check_auth(request)
    try:
        return {"ok": True, **_fund_quote(code)}
    except Exception as e:
        raise HTTPException(status_code=502, detail="净值获取失败: %s" % e)

@app.get("/app/fund/search")
async def app_fund_search(request: Request, k: str = ""):
    check_auth(request)
    try:
        raw = _fund_http_get("https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=" + urllib.parse.quote(k), referer="http://fund.eastmoney.com/")
        d = _json.loads(raw)
        out = [{"code": x.get("CODE"), "name": x.get("NAME")} for x in (d.get("Datas") or [])[:8]]
        return {"ok": True, "results": out}
    except Exception as e:
        return {"ok": False, "results": [], "error": str(e)}

@app.get("/app/fund/holdings")
async def app_fund_holdings(request: Request):
    check_auth(request)
    _fund_db_init()
    rows = db().execute("SELECT * FROM fund_holdings ORDER BY id").fetchall()
    return {"holdings": [dict(r) for r in rows]}

@app.post("/app/fund/holdings")
async def app_fund_holdings_add(request: Request):
    check_auth(request)
    _fund_db_init()
    body = await request.json()
    code = (body.get("code") or "").strip()
    if not code or not code.isdigit():
        raise HTTPException(status_code=400, detail="基金代码必须是数字")
    name = body.get("name") or ""
    if not name:
        try:
            r = _fund_http_get("https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=" + code, referer="http://fund.eastmoney.com/")
            d = _json.loads(r)
            for x in (d.get("Datas") or []):
                if x.get("CODE") == code:
                    name = x.get("NAME") or ""
                    break
        except Exception:
            pass
    db().execute("INSERT INTO fund_holdings(code,name,shares,cost,note) VALUES(?,?,?,?,?)",
                 (code, name, float(body.get("shares") or 0), float(body.get("cost") or 0), body.get("note") or ""))
    db().commit()
    return {"ok": True}

@app.delete("/app/fund/holdings/{hid}")
async def app_fund_holdings_del(hid: int, request: Request):
    check_auth(request)
    _fund_db_init()
    db().execute("DELETE FROM fund_holdings WHERE id=?", (hid,))
    db().commit()
    return {"ok": True}

@app.get("/app/fund/overview")
async def app_fund_overview(request: Request):
    check_auth(request)
    _fund_db_init()
    rows = db().execute("SELECT * FROM fund_holdings ORDER BY id").fetchall()
    out = []
    total_profit = 0.0
    for r in rows:
        h = dict(r)
        try:
            q = _fund_quote(h["code"])
            h.update(q)
            if h.get("shares") and h.get("cost") and h["cost"] > 0:
                profit = (q["nav"] - h["cost"]) * h["shares"]
                h["profit"] = round(profit, 2)
                h["profit_pct"] = round((q["nav"] / h["cost"] - 1) * 100, 2)
                total_profit += profit
        except Exception as e:
            h["error"] = str(e)
        out.append(h)
    return {"holdings": out, "total_profit": round(total_profit, 2)}



# ==================== 愿望池 Wishes ====================
def _wish_db_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS wishes(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            fulfilled_at TEXT
        )""")
        conn.commit()

@app.get("/app/wish/list")
async def app_wish_list(request: Request):
    check_auth(request)
    _wish_db_init()
    with db() as conn:
        rows = conn.execute("SELECT * FROM wishes ORDER BY id DESC").fetchall()
    return {"wishes": [dict(r) for r in rows]}

@app.post("/app/wish/add")
async def app_wish_add(request: Request):
    check_auth(request)
    _wish_db_init()
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="愿望不能为空")
    with db() as conn:
        cur = conn.execute("INSERT INTO wishes(text) VALUES(?)", (text,))
        conn.commit()
    return {"ok": True, "id": cur.lastrowid}

@app.post("/app/wish/draw")
async def app_wish_draw(request: Request):
    """AI 抽取一个愿望去实现。"""
    check_auth(request)
    _wish_db_init()
    with db() as conn:
        row = conn.execute("SELECT * FROM wishes WHERE status='active' ORDER BY RANDOM() LIMIT 1").fetchone()
    if not row:
        return {"ok": False, "message": "愿望池是空的，先去许个愿吧"}
    return {"ok": True, "wish": dict(row)}

@app.post("/app/wish/fulfill/{wid}")
async def app_wish_fulfill(wid: int, request: Request):
    check_auth(request)
    _wish_db_init()
    with db() as conn:
        conn.execute("UPDATE wishes SET status='fulfilled', fulfilled_at=datetime('now','localtime') WHERE id=?", (wid,))
        conn.commit()
    return {"ok": True}

@app.delete("/app/wish/{wid}")
async def app_wish_del(wid: int, request: Request):
    check_auth(request)
    _wish_db_init()
    with db() as conn:
        conn.execute("DELETE FROM wishes WHERE id=?", (wid,))
        conn.commit()
    return {"ok": True}



# ============ 通用配置（宝宝自己填的入口） ============
@app.get("/app/config/get")
async def config_get(request: Request):
    check_auth(request)
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        rows = conn.execute("SELECT key,value FROM kv WHERE key LIKE 'config:%'").fetchall()
    out = {}
    for r in rows:
        out[r["key"][7:]] = r["value"]
    return {"config": out}

@app.post("/app/config/set")
async def config_set(request: Request):
    check_auth(request)
    body = await request.json()
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        for k, v in body.items():
            conn.execute("INSERT OR REPLACE INTO kv (key,value) VALUES (?,?)", ("config:"+k, str(v)))
        conn.commit()
    return {"ok": True}



# ============ 模型配置系统（模型参数 + 功能绑定）============
def _models_db_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS model_configs(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            provider TEXT DEFAULT 'openai',
            endpoint TEXT NOT NULL,
            api_key TEXT NOT NULL,
            model TEXT NOT NULL,
            models TEXT DEFAULT '[]',
            thinking_level TEXT DEFAULT '',
            temperature REAL DEFAULT 0.7,
            max_tokens INTEGER DEFAULT 2048,
            is_default INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        # 旧库升级:补 models 列(JSON 数组,该站点可用的模型清单)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(model_configs)").fetchall()}
        if "models" not in cols:
            conn.execute("ALTER TABLE model_configs ADD COLUMN models TEXT DEFAULT '[]'")
        if "thinking_level" not in cols:
            conn.execute("ALTER TABLE model_configs ADD COLUMN thinking_level TEXT DEFAULT ''")
        conn.execute("""CREATE TABLE IF NOT EXISTS function_bindings(
            func TEXT PRIMARY KEY,
            config_id INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        conn.commit()

def _normalize_models(v) -> list:
    """models 字段容错:接受数组/逗号分隔字符串,返回去重非空的字符串数组。"""
    if isinstance(v, list):
        items = [str(x).strip() for x in v]
    else:
        items = [x.strip() for x in str(v or "").replace("，", ",").split(",")]
    out, seen = [], set()
    for x in items:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out

def _config_dict(row) -> dict:
    d = dict(row)
    try:
        d["models"] = json.loads(d.get("models") or "[]")
        if not isinstance(d["models"], list):
            d["models"] = []
    except Exception:
        d["models"] = []
    return d

FUNCTION_LABELS = {
    "video_call": "视频通话",
    "chat": "对话功能",
    "voice": "语音通话",
    "translation": "翻译功能",
    "grep": "Grep检索",
    "group_plan": "群组规划",
    "context_summary": "上下文总结",
    "title_gen": "AI总结标题",
    "memory_update": "记忆更新",
    "image_recog": "图像识别",
    "audio_recog": "音频识别",
    "video_recog": "视频识别",
    "diary": "日记处理",
    "gift": "礼物生成",
    "tarot": "塔罗解读",
    "letter": "书信回复",
}

@app.get("/app/models/list")
async def models_list(request: Request):
    check_auth(request)
    _models_db_init()
    with db() as conn:
        cfgs = [_config_dict(r) for r in conn.execute("SELECT * FROM model_configs ORDER BY is_default DESC, id").fetchall()]
        binds = {r["func"]: r["config_id"] for r in conn.execute("SELECT func,config_id FROM function_bindings").fetchall()}
    return {"configs": cfgs, "bindings": binds, "labels": FUNCTION_LABELS}

@app.post("/app/models/add")
async def models_add(request: Request):
    check_auth(request)
    _models_db_init()
    body = await request.json()
    name = (body.get("name") or "").strip()
    endpoint = (body.get("endpoint") or "").strip()
    api_key = (body.get("api_key") or "").strip()
    model = (body.get("model") or "").strip()
    if not name or not endpoint or not model:
        raise HTTPException(status_code=400, detail="名称/端点/模型名必填")
    models = json.dumps(_normalize_models(body.get("models")), ensure_ascii=False)
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO model_configs(name,provider,endpoint,api_key,model,models,thinking_level,temperature,max_tokens,is_default) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (name, body.get("provider") or "openai", endpoint, api_key, model,
             models, str(body.get("thinking_level") or ""),
             float(body.get("temperature") or 0.7), int(body.get("max_tokens") or 2048),
             1 if body.get("is_default") else 0))
        if body.get("is_default"):
            conn.execute("UPDATE model_configs SET is_default=0 WHERE id!=?", (cur.lastrowid,))
        conn.commit()
    return {"ok": True, "id": cur.lastrowid}

@app.post("/app/models/update/{cid}")
async def models_update(cid: int, request: Request):
    check_auth(request)
    _models_db_init()
    body = await request.json()
    fields = []
    vals = []
    for k in ["name", "provider", "endpoint", "api_key", "model", "thinking_level", "temperature", "max_tokens", "is_default"]:
        if k in body:
            fields.append(k + "=?")
            vals.append(body[k])
    if "models" in body:
        fields.append("models=?")
        vals.append(json.dumps(_normalize_models(body.get("models")), ensure_ascii=False))
    if not fields:
        return {"ok": False}
    vals.append(cid)
    with db() as conn:
        conn.execute("UPDATE model_configs SET " + ",".join(fields) + " WHERE id=?", vals)
        if body.get("is_default"):
            conn.execute("UPDATE model_configs SET is_default=0 WHERE id!=?", (cid,))
        conn.commit()
    return {"ok": True}

@app.delete("/app/models/{cid}")
async def models_del(cid: int, request: Request):
    check_auth(request)
    _models_db_init()
    with db() as conn:
        conn.execute("DELETE FROM model_configs WHERE id=?", (cid,))
        conn.execute("UPDATE function_bindings SET config_id=0 WHERE config_id=?", (cid,))
        conn.commit()
    return {"ok": True}

@app.post("/app/models/bind")
async def models_bind(request: Request):
    check_auth(request)
    _models_db_init()
    body = await request.json()
    func = body.get("func")
    config_id = int(body.get("config_id") or 0)
    if func not in FUNCTION_LABELS:
        raise HTTPException(status_code=400, detail="未知功能")
    with db() as conn:
        conn.execute("INSERT OR REPLACE INTO function_bindings(func,config_id,updated_at) VALUES(?,?,datetime('now','localtime'))", (func, config_id))
        conn.commit()
    return {"ok": True}

@app.get("/app/models/resolve")
async def models_resolve(request: Request, func: str = "chat"):
    check_auth(request)
    _models_db_init()
    with db() as conn:
        bind = conn.execute("SELECT config_id FROM function_bindings WHERE func=?", (func,)).fetchone()
        if bind and bind["config_id"]:
            cfg = conn.execute("SELECT * FROM model_configs WHERE id=?", (bind["config_id"],)).fetchone()
        else:
            cfg = conn.execute("SELECT * FROM model_configs WHERE is_default=1 LIMIT 1").fetchone()
        if not cfg:
            cfg = conn.execute("SELECT * FROM model_configs ORDER BY id LIMIT 1").fetchone()
    if not cfg:
        raise HTTPException(status_code=404, detail="没有配置任何模型")
    return {"config": _config_dict(cfg)}


@app.get("/app/models/available/{cid}")
async def models_available(cid: int, request: Request):
    """拉取某配置站点的可用模型清单(OpenAI 兼容 GET {endpoint}/models)。
    站点不支持/网络失败时返回空列表,前端降级用配置里手动存的 models。"""
    check_auth(request)
    _models_db_init()
    with db() as conn:
        row = conn.execute("SELECT * FROM model_configs WHERE id=?", (cid,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="配置不存在")
    cfg = _config_dict(row)
    base = (cfg.get("endpoint") or "").strip().rstrip("/")
    ids = []
    err = ""
    if base:
        url = base + "/models"
        req = urllib.request.Request(url, headers={
            "Authorization": "Bearer " + (cfg.get("api_key") or ""),
            "Content-Type": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                d = json.loads(resp.read().decode("utf-8", errors="ignore"))
            data = d.get("data") if isinstance(d, dict) else d
            if isinstance(data, list):
                for it in data:
                    mid = it.get("id") if isinstance(it, dict) else (str(it) if it else "")
                    if mid:
                        ids.append(str(mid))
        except Exception as e:
            err = str(e)[:150]
    ids = sorted(set(ids))
    return {"models": ids, "stored": cfg.get("models") or [], "error": err}



# ============ 模型连接测试 ============
@app.post("/app/settings/test_model")
async def settings_test_model(request: Request):
    """测试一个模型配置是否可用。"""
    check_auth(request)
    body = await request.json()
    endpoint = (body.get("endpoint") or "").strip().rstrip("/")
    api_key = (body.get("api_key") or "").strip()
    model = (body.get("model") or "").strip()
    if not endpoint or not model:
        raise HTTPException(status_code=400, detail="端点和模型名必填")
    url = endpoint + "/chat/completions"
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "回复ok两个字"}],
        "max_tokens": 10,
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + api_key,
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            d = json.loads(resp.read().decode("utf-8", errors="ignore"))
        reply = ""
        if d.get("choices"):
            reply = (d["choices"][0].get("message") or {}).get("content") or ""
        return {"ok": True, "reply": reply[:50], "endpoint": url}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}




# ============ AI生图礼物（通用生图端点，兼容OpenAI格式） ============
import base64 as _b64
import os as _os
GIFT_IMG_DIR = Path(os.environ.get("MOONLIGHT_DATA_DIR", "data")) / "gift_images"

def _gift_img_dir():
    GIFT_IMG_DIR.mkdir(parents=True, exist_ok=True)
    return GIFT_IMG_DIR

@app.post("/app/gift/draw")
async def gift_draw(request: Request):
    """AI生图：从模型配置里找 is_default=1 且 image 能力，或走通用 config 里的生图端点。"""
    check_auth(request)
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt不能为空")
    # 先尝试通用配置里的生图端点
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        row = conn.execute("SELECT value FROM kv WHERE key='config:draw_endpoint'").fetchone()
        row_key = conn.execute("SELECT value FROM kv WHERE key='config:draw_api_key'").fetchone()
        row_model = conn.execute("SELECT value FROM kv WHERE key='config:draw_model'").fetchone()
    endpoint = (row["value"] if row else "") or (body.get("endpoint") or "")
    api_key = (row_key["value"] if row_key else "") or (body.get("api_key") or "")
    model = (row_model["value"] if row_model else "") or (body.get("model") or "")
    if not endpoint or not api_key:
        return {"ok": False, "error": "请先在设置里配置生图API（端点+密钥）"}
    # 兼容两种端点格式
    if not endpoint.endswith("/images/generations"):
        endpoint = endpoint.rstrip("/") + "/images/generations"
    payload = {"prompt": prompt, "n": 1, "size": body.get("size", "1024x1024")}
    if model:
        payload["model"] = model
    req = urllib.request.Request(endpoint, data=json.dumps(payload).encode("utf-8"), headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + api_key,
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read().decode("utf-8", errors="ignore"))
    except Exception as e:
        return {"ok": False, "error": "生图请求失败: %s" % e}
    b64 = None
    if data.get("data") and data["data"][0].get("b64_json"):
        b64 = data["data"][0]["b64_json"]
        img_bytes = _b64.b64decode(b64)
    elif data.get("data") and data["data"][0].get("url"):
        img_url = data["data"][0]["url"]
        try:
            with urllib.request.urlopen(img_url, timeout=60) as r2:
                img_bytes = r2.read()
        except Exception:
            return {"ok": True, "image_url": img_url}
    else:
        return {"ok": False, "error": "生图响应格式异常"}
    fname = f"gift_{int(time.time())}.png"
    fpath = _gift_img_dir() / fname
    fpath.write_bytes(img_bytes)
    return {"ok": True, "image_url": f"/app/gift/image/{fname}"}

@app.get("/app/gift/image/{fname}")
async def gift_image(fname: str, request: Request):
    check_auth(request)
    fpath = _gift_img_dir() / fname
    if not fpath.exists():
        raise HTTPException(status_code=404, detail="image not found")
    return FileResponse(str(fpath), media_type="image/png")

@app.get("/app/gift/gallery")
async def gift_gallery(request: Request):
    check_auth(request)
    d = _gift_img_dir()
    imgs = sorted([f"/app/gift/image/{p.name}" for p in d.glob("*.png")], reverse=True)
    return {"images": imgs[:30]}



# ============ 哨兵（Sentinel 主动推送） ============
import asyncio as _aio

SENTINEL_RULES = {
    "morning_fund": {"name": "早安基金播报", "cron": "08:30", "enabled": True},
    "evening_fund": {"name": "晚安基金播报", "cron": "20:30", "enabled": True},
    "calendar_remind": {"name": "纪念日提醒", "cron": "09:00", "enabled": True},
    "wish_check": {"name": "愿望池巡检", "cron": "21:00", "enabled": False},
}
SENTINEL_STATE = {"last_run": {}, "running": False, "task": None}

async def _sentinel_loop():
    """每60秒检查一次：当前时间是否命中规则 cron 且今天没跑过。"""
    while True:
        try:
            import datetime as _dt
            now = _dt.datetime.now()
            hm = now.strftime("%H:%M")
            today = now.strftime("%Y-%m-%d")
            for rid, rule in SENTINEL_RULES.items():
                if not rule.get("enabled"):
                    continue
                if rule["cron"] == hm and SENTINEL_STATE["last_run"].get(rid) != today:
                    SENTINEL_STATE["last_run"][rid] = today
                    try:
                        await _sentinel_run(rid)
                    except Exception as e:
                        print(f"[sentinel] {rid} error: {e}")
        except Exception:
            pass
        await _aio.sleep(60)

async def _sentinel_run(rid: str):
    """执行一条哨兵任务并把结果推到聊天窗口。"""
    if rid in ("morning_fund", "evening_fund"):
        rows = db().execute("SELECT * FROM fund_holdings").fetchall()
        if not rows:
            return
        lines = []
        total_pct = 0.0
        n = 0
        for r in rows:
            h = dict(r)
            try:
                q = _fund_quote(h["code"])
                arrow = "↑" if q["day_pct"] >= 0 else "↓"
                lines.append(f"{h['name'] or h['code']} {q['nav']} {arrow}{abs(q['day_pct'])}%")
                total_pct += q["day_pct"]
                n += 1
            except Exception:
                lines.append(f"{h['name'] or h['code']} 拉取失败")
        avg = total_pct / n if n else 0
        mood = "今天小鹅们精神不错" if avg >= 0 else "小鹅们今天有点蔫"
        up_flag = "涨" if avg >= 0 else "跌"
        text = "💰 [哨兵] Love基金播报\n" + "\n".join(lines) + "\n\n整体" + up_flag + " " + format(abs(avg), ".2f") + "%，" + mood + "。"
    elif rid == "calendar_remind":
        import datetime as _dt
        today = _dt.date.today().isoformat()
        with db() as conn:
            events = conn.execute("SELECT * FROM calendar_events WHERE date=?", (today,)).fetchall()
        if not events:
            return
        text = "📅 [哨兵] 今天的纪念日:\n" + "\n".join(e["title"] for e in events)
    elif rid == "wish_check":
        with db() as conn:
            row = conn.execute("SELECT COUNT(*) c FROM wishes WHERE status='active'").fetchone()
        if not row["c"]:
            return
        text = f"🌠 [哨兵] 愿望池里还有 {row['c']} 个愿望在等安念捞。"
    else:
        return
    msg = save_message("ai", "sentinel", text, {"event": "sentinel", "rule": rid})
    await broadcast(plugin_subs, plugin_payload(msg))
    await broadcast(app_subs, app_payload(msg))

@app.get("/app/sentinel/status")
async def sentinel_status(request: Request):
    check_auth(request)
    return {"rules": SENTINEL_RULES, "last_run": SENTINEL_STATE["last_run"], "running": SENTINEL_STATE["running"]}

@app.post("/app/sentinel/toggle")
async def sentinel_toggle(request: Request):
    check_auth(request)
    body = await request.json()
    rid = body.get("rule")
    if rid not in SENTINEL_RULES:
        raise HTTPException(status_code=400, detail="未知规则")
    SENTINEL_RULES[rid]["enabled"] = bool(body.get("enabled"))
    return {"ok": True, "rules": SENTINEL_RULES}

@app.post("/app/sentinel/run")
async def sentinel_run_now(request: Request):
    """手动触发一条哨兵任务（测试用）。"""
    check_auth(request)
    body = await request.json()
    rid = body.get("rule")
    if rid not in SENTINEL_RULES:
        raise HTTPException(status_code=400, detail="未知规则")
    await _sentinel_run(rid)
    return {"ok": True}

@app.on_event("startup")
async def _sentinel_startup():
    if not SENTINEL_STATE["running"]:
        SENTINEL_STATE["task"] = _aio.create_task(_sentinel_loop())
        SENTINEL_STATE["running"] = True




# ============ 记忆语义检索（轻量混合：关键词+标签+TF打分） ============
import re as _re

def _mem_score(q: str, text: str, tags: str) -> float:
    """轻量打分：完整包含>分词命中>前缀命中。M10后可升级真向量。"""
    if not q or not text:
        return 0.0
    score = 0.0
    if q in text:
        score += 10.0
    qwords = _re.split(r'[\s,，。；;、]+', q)
    for w in qwords:
        if len(w) >= 2 and w in text:
            score += 3.0
        elif len(w) >= 2 and text.find(w[:2]) >= 0:
            score += 0.5
    if tags and q in tags:
        score += 6.0
    return score

@app.get("/app/memories/search")
async def memories_search(request: Request, q: str = "", limit: int = 8):
    check_auth(request)
    q = q.strip()
    if not q:
        return {"results": []}
    _memories_init()
    with db() as conn:
        rows = conn.execute("SELECT * FROM memories ORDER BY id DESC LIMIT 500").fetchall()
    scored = []
    for r in rows:
        m = dict(r)
        s = _mem_score(q, m.get("content") or "", "")
        if s > 0:
            m["score"] = round(s, 1)
            scored.append(m)
    scored.sort(key=lambda x: -x["score"])
    return {"results": scored[:limit], "total": len(scored)}



# ============ 记忆向量检索（语义搜索） ============
def _mem_search_db_init():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS mem_embeddings(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mem_id INTEGER,
            text TEXT,
            vec TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        conn.commit()

@app.post("/app/memory/embed")
async def memory_embed(request: Request):
    """给一条记忆生成向量（调用配置里的 embedding 端点，无则返回占位）。"""
    check_auth(request)
    _mem_search_db_init()
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text不能为空")
    # 优先走通用配置的 embedding 端点
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        r1 = conn.execute("SELECT value FROM kv WHERE key='config:embed_endpoint'").fetchone()
        r2 = conn.execute("SELECT value FROM kv WHERE key='config:embed_api_key'").fetchone()
        r3 = conn.execute("SELECT value FROM kv WHERE key='config:embed_model'").fetchone()
    ep = r1["value"] if r1 else ""
    key = r2["value"] if r2 else ""
    model = r3["value"] if r3 else "text-embedding-3-small"
    vec = None
    if ep and key:
        req = urllib.request.Request(ep.rstrip('/') + '/embeddings', data=json.dumps({"input": text, "model": model}).encode(), headers={"Content-Type":"application/json","Authorization":"Bearer "+key})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read().decode())
            vec = d["data"][0]["embedding"]
        except Exception as e:
            return {"ok": False, "error": str(e)}
    # 降级：用字符级简单哈希向量（本地兜底，仍能粗略比较）
    if vec is None:
        import hashlib as _hl
        toks = text[:200]
        vec = [float(ord(c) % 64)/64.0 for c in toks]
        vec = (vec + [0.0]*128)[:128]
    with db() as conn:
        cur = conn.execute("INSERT INTO mem_embeddings(text,vec) VALUES(?,?)", (text, json.dumps(vec)))
        conn.commit()
    return {"ok": True, "id": cur.lastrowid, "dim": len(vec)}

@app.post("/app/memory/search")
async def memory_search(request: Request):
    """余弦相似度召回最相关记忆。"""
    check_auth(request)
    _mem_search_db_init()
    body = await request.json()
    q = (body.get("query") or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="query不能为空")
    # 同样生成 query 向量
    import hashlib as _hl
    toks = q[:200]
    qv = [float(ord(c) % 64)/64.0 for c in toks]
    qv = (qv + [0.0]*128)[:128]
    import math as _m
    with db() as conn:
        rows = conn.execute("SELECT id,text,vec FROM mem_embeddings ORDER BY id DESC LIMIT 500").fetchall()
    scored = []
    for r in rows:
        try:
            v = json.loads(r["vec"])
        except Exception:
            continue
        n = min(len(qv), len(v))
        dot = sum(qv[i]*v[i] for i in range(n))
        na = _m.sqrt(sum(x*x for x in qv[:n])) + 1e-9
        nb = _m.sqrt(sum(x*x for x in v[:n])) + 1e-9
        sim = dot/(na*nb)
        scored.append({"id": r["id"], "text": r["text"], "score": round(sim, 4)})
    scored.sort(key=lambda x: -x["score"])
    return {"results": scored[:10]}



# ============ 手机摄像头（WebRTC直连·浏览器getUserMedia） ============
CAM_LAST_FRAME = {"ts": 0, "b64": None, "note": ""}

@app.post("/app/cam/push")
async def cam_push(request: Request):
    """前端每N秒推一帧（dataUrl或base64），存内存供AI读取。"""
    check_auth(request)
    body = await request.json()
    b64 = (body.get("b64") or "").strip()
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[-1]
    if not b64:
        raise HTTPException(status_code=400, detail="b64不能为空")
    CAM_LAST_FRAME["ts"] = time.time()
    CAM_LAST_FRAME["b64"] = b64
    CAM_LAST_FRAME["note"] = body.get("note") or ""
    return {"ok": True, "ts": CAM_LAST_FRAME["ts"]}

@app.get("/app/cam/latest")
async def cam_latest(request: Request):
    """AI/前端读取当前帧。age_seconds 用于判断是否在线。"""
    check_auth(request)
    age = int(time.time() - CAM_LAST_FRAME["ts"]) if CAM_LAST_FRAME["ts"] else -1
    return {"has_frame": bool(CAM_LAST_FRAME["b64"]), "age_seconds": age, "note": CAM_LAST_FRAME["note"]}

@app.get("/app/cam/frame")
async def cam_frame(request: Request):
    """返回当前帧图片（PNG）。"""
    check_auth(request)
    if not CAM_LAST_FRAME["b64"]:
        raise HTTPException(status_code=404, detail="no frame yet — open camera first")
    img_bytes = _b64.b64decode(CAM_LAST_FRAME["b64"])
    return Response(content=img_bytes, media_type="image/jpeg")


# ============ 手机摄像头（本地getUserMedia + 拍照存档） ============
CAMERA_DIR = Path(os.environ.get("MOONLIGHT_DATA_DIR", "data")) / "camera_photos"

def _camera_dir():
    CAMERA_DIR.mkdir(parents=True, exist_ok=True)
    return CAMERA_DIR

@app.post("/app/camera/upload")
async def camera_upload(request: Request):
    """前端拍照后上传（base64 JPEG）。"""
    check_auth(request)
    body = await request.json()
    b64 = (body.get("image") or "")
    if not b64.startswith("data:image"):
        raise HTTPException(status_code=400, detail="需要 data:image/jpeg;base64,... 格式")
    try:
        img_b64 = b64.split(",", 1)[1]
        img_bytes = _b64.b64decode(img_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="图片解析失败")
    fname = f"cam_{int(time.time()*1000)}.jpg"
    (_camera_dir() / fname).write_bytes(img_bytes)
    # 存一条消息让聊天窗口知道
    note = (body.get("note") or "").strip()
    try:
        save_message("user", "camera", f"📷 薇薇拍了张照片给安念看" + (f"：{note}" if note else ""), {"event": "camera", "file": fname})
    except Exception:
        pass
    return {"ok": True, "file": fname, "url": f"/app/camera/photo/{fname}"}

@app.get("/app/camera/photo/{fname}")
async def camera_photo(fname: str, request: Request):
    check_auth(request)
    fpath = _camera_dir() / fname
    if not fpath.exists() or "/" in fname or ".." in fname:
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(str(fpath), media_type="image/jpeg")

@app.get("/app/camera/photos")
async def camera_photos(request: Request):
    """最近照片列表（给安念回看）。"""
    check_auth(request)
    d = _camera_dir()
    files = sorted([p.name for p in d.glob("cam_*.jpg")], reverse=True)[:30]
    return {"photos": [f"/app/camera/photo/{f}" for f in files]}



# 静态前端：挂 web/ 到根路径（放在最后，避免吞掉API路由）
# ============ Operit 数据全量导入（记忆/聊天/角色卡） ============
@app.post("/app/memory/import")
async def memory_import(request: Request):
    """导入Operit记忆库JSON。兼容两种格式：
    1. OB桶导出: [{title, content, created, tags, importance}]
    2. Operit记忆: [{content, importance, timestamp}]
    增量合并（同content跳过）。"""
    check_auth(request)
    _memories_init()
    body = await request.json()
    items = body if isinstance(body, list) else body.get("memories", body.get("items", []))
    added, skipped = 0, 0
    with db() as conn:
        existing = {r[0] for r in conn.execute("SELECT content FROM memories").fetchall()}
        import datetime as _dt
        for it in items:
            content = (it.get("content") or it.get("text") or "").strip()
            if not content or content in existing:
                skipped += 1
                continue
            imp = it.get("importance") or it.get("score") or 5
            if isinstance(imp, float) and imp <= 1.0:
                imp = int(imp * 10)
            created = it.get("created") or it.get("created_at") or it.get("timestamp") or _dt.datetime.now().isoformat()
            conn.execute(
                "INSERT INTO memories(content,importance,arousal,valence,created_at,last_activated) VALUES(?,?,?,?,?,?)",
                (content, int(imp), 0.3, 0.5, str(created)[:19], str(created)[:19]))
            existing.add(content)
            added += 1
        conn.commit()
    return {"ok": True, "added": added, "skipped": skipped, "total": added + skipped}

@app.post("/app/chat/import")
async def chat_import(request: Request):
    """导入Operit聊天记录JSONL/JSON。格式：[{from/human/ai, text, ts, session_id?}]
    存进messages表，打上api_session标记（默认imported）。"""
    check_auth(request)
    body = await request.json()
    items = body if isinstance(body, list) else body.get("messages", [])
    session = (body.get("session_id") if isinstance(body, dict) else "") or "imported"
    added = 0
    with db() as conn:
        for it in items:
            text = (it.get("text") or it.get("content") or "").strip()
            if not text:
                continue
            frm = it.get("from") or it.get("role") or "human"
            if frm in ("user", "human", "我"):
                direction, kind = "human", "user"
            else:
                direction, kind = "ai", "text"
            ts = it.get("ts") or it.get("timestamp") or None
            try:
                conn.execute(
                    "INSERT INTO messages(direction,kind,text,meta,created_at) VALUES(?,?,?,?,COALESCE(?,datetime('now','localtime')))",
                    (direction, kind, text, json.dumps({"api_session": session, "imported": True}), ts))
                added += 1
            except Exception:
                pass
        conn.commit()
    return {"ok": True, "added": added, "session": session}

@app.get("/app/export/operit_format")
async def export_operit_format(request: Request):
    """反向导出：月光数据→Operit可导入格式（备份用）。"""
    check_auth(request)
    with db() as conn:
        mems = [dict(r) for r in conn.execute("SELECT content,importance,created_at FROM memories").fetchall()]
        msgs = [dict(r) for r in conn.execute("SELECT direction,kind,text,created_at FROM messages ORDER BY id LIMIT 5000").fetchall()]
    return {"memories": mems, "messages": msgs}


# ============ OB桶同步（从服务器拉取全部记忆进星图） ============
import subprocess as _sp
OB_SSH = "ssh -i ~/.ssh/id_ed25519 -o ConnectTimeout=10 -o StrictHostKeyChecking=no root@47.96.174.224"

def _ob_ssh_conf() -> str:
    """OB 同步的 SSH 目标:kv(config:ob_ssh)优先,回退 env,再回退旧默认。"""
    try:
        with db() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
            row = conn.execute("SELECT value FROM kv WHERE key='config:ob_ssh'").fetchone()
        if row and (row["value"] or "").strip():
            return row["value"].strip()
    except Exception:
        pass
    return os.environ.get("OB_SSH", OB_SSH)

@app.post("/app/memory/sync_ob")
async def memory_sync_ob(request: Request):
    check_auth(request)
    _memories_init()
    D = chr(36)  # dollar sign
    Q = chr(34)  # double quote
    remote = "cd /root/Ombre-Brain/buckets/dynamic && for f in *.md; do echo ===FILE===" + D + "f; cat " + Q + D + "f" + Q + "; done"
    cmd = _ob_ssh_conf() + " " + chr(39) + remote + chr(39)
    try:
        r = _sp.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
    except Exception as e:
        raise HTTPException(status_code=502, detail="OB ssh超时: %s" % e)
    out = r.stdout or ""
    files = []
    for chunk in out.split("===FILE==="):
        chunk = chunk.strip()
        if not chunk or "\n" not in chunk:
            continue
        fn, _, body = chunk.partition("\n")
        if fn.startswith("==") or not body.strip():
            continue
        files.append({"filename": fn.strip(), "text": body})
    added, skipped = 0, 0
    with db() as conn:
        existing = {r2[0] for r2 in conn.execute("SELECT content FROM memories").fetchall()}
        for f in files:
            text = f["text"]
            meta = {}
            body = text
            if text.startswith("---"):
                parts = text.split("---", 2)
                if len(parts) >= 3:
                    for line in parts[1].split("\n"):
                        if ":" in line:
                            k, _, v = line.partition(":")
                            meta[k.strip()] = v.strip().strip(Q).strip(chr(39))
                    body = parts[2]
            title = meta.get("title", "")
            content = (title + "\n" + body).strip() if title else body.strip()
            if not content or content in existing:
                skipped += 1
                continue
            try:
                imp = int(meta.get("importance", 5))
            except Exception:
                imp = 5
            created = (meta.get("created", "") or "")[:19] or None
            conn.execute(
                "INSERT INTO memories(content,importance,arousal,valence,created_at,last_activated) VALUES(?,?,?,?,COALESCE(?,datetime('now','localtime')),datetime('now','localtime'))",
                (content, imp, 0.3, 0.5, created))
            existing.add(content)
            added += 1
        conn.commit()
    return {"ok": True, "files": len(files), "added": added, "skipped": skipped}


# ============ 功能模型统一调用（按绑定路由到对应模型） ============
def _resolve_model_for(func: str) -> dict:
    """按功能名解析绑定的模型配置（无绑定则用默认）。"""
    with db() as conn:
        bind = conn.execute("SELECT config_id FROM function_bindings WHERE func=?", (func,)).fetchone()
        if bind and bind["config_id"]:
            cfg = conn.execute("SELECT * FROM model_configs WHERE id=?", (bind["config_id"],)).fetchone()
        else:
            cfg = conn.execute("SELECT * FROM model_configs WHERE is_default=1 LIMIT 1").fetchone()
        if not cfg:
            cfg = conn.execute("SELECT * FROM model_configs ORDER BY id LIMIT 1").fetchone()
    return dict(cfg) if cfg else {}

@app.post("/app/invoke/{func}")
async def invoke_with_func_model(func: str, request: Request):
    """统一模型调用代理：POST /app/invoke/chat  {messages:[{role,content}], max_tokens?}
    自动按 function_bindings 路由到绑定的模型执行。返回 OpenAI 格式响应。"""
    check_auth(request)
    body = await request.json()
    messages = body.get("messages") or []
    if not messages:
        raise HTTPException(status_code=400, detail="messages不能为空")
    cfg = _resolve_model_for(func)
    if not cfg:
        raise HTTPException(status_code=404, detail="没有可用模型配置")
    ep = (cfg.get("endpoint") or "").rstrip("/")
    if not ep.endswith("/chat/completions"):
        ep = ep + "/chat/completions"
    payload = {
        "model": cfg.get("model"),
        "messages": messages,
    }
    if body.get("max_tokens"):
        payload["max_tokens"] = int(body["max_tokens"])
    if body.get("temperature") is not None:
        payload["temperature"] = float(body["temperature"])
    req = urllib.request.Request(ep, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (cfg.get("api_key") or ""),
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            d = json.loads(resp.read().decode("utf-8", errors="ignore"))
        return {"ok": True, "func": func, "model": cfg.get("model"), "config_name": cfg.get("name"), "response": d}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")[:300]
        raise HTTPException(status_code=e.code, detail="模型调用失败: %s" % detail)
    except Exception as e:
        raise HTTPException(status_code=502, detail="模型调用失败: %s" % e)

@app.get("/app/models/bindings_full")
async def bindings_full(request: Request):
    """返回全部功能绑定+对应模型详情（可视化面板用）。"""
    check_auth(request)
    _models_db_init()
    with db() as conn:
        binds = conn.execute("SELECT func,config_id FROM function_bindings").fetchall()
        out = {}
        for b in binds:
            cfg = conn.execute("SELECT id,name,model,endpoint FROM model_configs WHERE id=?", (b["config_id"],)).fetchone()
            if cfg:
                out[b["func"]] = dict(cfg)
    return {"bindings": out}


# ============ 记忆系统 API（AionsHome 同款：配置/召回/总结/审核台）============
@app.get("/app/mem/config")
async def mem_config_get(request: Request):
    check_auth(request)
    _memsys.mem_init(db)
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
        anchor = _memsys.get_anchor(conn)
        total = conn.execute("SELECT COUNT(*) c FROM memories").fetchone()["c"]
        embedded = conn.execute("SELECT COUNT(*) c FROM memories WHERE embedding!=''").fetchone()["c"]
        unresolved = conn.execute("SELECT COUNT(*) c FROM memories WHERE unresolved=1").fetchone()["c"]
    # 密钥只回掩码，不回明文
    def _mask(k):
        k = str(k or "")
        return (k[:6] + "***" + k[-4:]) if len(k) > 12 else ("已设置" if k else "")
    return {
        "embed_endpoint": cfg["embed_endpoint"], "embed_model": cfg["embed_model"],
        "embed_key_set": bool(cfg["embed_key"]), "embed_key_masked": _mask(cfg["embed_key"]),
        "sentinel_endpoint": cfg["sentinel_endpoint"], "sentinel_model": cfg["sentinel_model"],
        "sentinel_key_set": bool(cfg["sentinel_key"]), "sentinel_key_masked": _mask(cfg["sentinel_key"]),
        "stats": {"total": total, "embedded": embedded, "unresolved": unresolved, "anchor": anchor},
    }


@app.post("/app/mem/config")
async def mem_config_set(request: Request):
    check_auth(request)
    _memsys.mem_init(db)
    body = await request.json()
    mapping = {
        "mem_embed_endpoint": body.get("embed_endpoint"),
        "mem_embed_key": body.get("embed_key"),
        "mem_embed_model": body.get("embed_model"),
        "mem_sentinel_endpoint": body.get("sentinel_endpoint"),
        "mem_sentinel_key": body.get("sentinel_key"),
        "mem_sentinel_model": body.get("sentinel_model"),
    }
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        for k, v in mapping.items():
            if v is None:
                continue
            conn.execute(
                "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, str(v).strip()),
            )
        conn.commit()
    return {"ok": True}


@app.post("/app/mem/test_embed")
async def mem_test_embed(request: Request):
    """测 embedding 端点是否可用（返回维度）。"""
    check_auth(request)
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
    vec = await asyncio.to_thread(_memsys.get_embedding, cfg, "月光记忆系统连通性测试")
    if not vec:
        raise HTTPException(status_code=502, detail="embedding 调用失败：检查端点/密钥/模型名")
    return {"ok": True, "dim": len(vec), "model": cfg["embed_model"]}


@app.post("/app/mem/recall")
async def mem_recall(request: Request):
    """语义召回测试：给 query，返回综合评分 Top 结果。"""
    check_auth(request)
    body = await request.json()
    q = str(body.get("query") or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="query 不能为空")
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
    res = await asyncio.to_thread(_memsys.recall_memories, db, cfg, q, body.get("keywords") or [])
    return {"results": res, "count": len(res)}


@app.post("/app/mem/add")
async def mem_add(request: Request):
    """加一条记忆（带情感坐标/关键词/待办标记，自动向量化）。"""
    check_auth(request)
    _memsys.mem_init(db)
    body = await request.json()
    content = str(body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content 不能为空")
    now = now_iso()
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
    vec = await asyncio.to_thread(_memsys.get_embedding, cfg, content)
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO memories(content,importance,arousal,valence,pinned,created_at,last_activated,"
            "activation_count,uuid,reviewed,embedding,keywords,unresolved,mem_type,emb_dim,updated_at)"
            " VALUES(?,?,?,?,?,?,?,0,'',1,?,?,?,?,?,?)",
            (content, max(1, min(10, int(body.get("importance") or 5))),
             float(body.get("arousal") or 0.3), float(body.get("valence") or 0.5),
             1 if body.get("pinned") else 0, now, now,
             _memsys._pack_vec(vec) if vec else "",
             json.dumps([str(k) for k in (body.get("keywords") or [])][:6], ensure_ascii=False),
             1 if body.get("unresolved") else 0, str(body.get("mem_type") or "event"),
             len(vec) if vec else 0, now),
        )
        conn.commit()
        mid = cur.lastrowid
    return {"ok": True, "id": mid, "embedded": bool(vec)}


@app.post("/app/mem/digest")
async def mem_digest(request: Request):
    """手动总结：把锚点之后的聊天提炼成记忆（或 draft=true 只出草案）。"""
    check_auth(request)
    _memsys.mem_init(db)
    body = await request.json()
    draft_only = bool(body.get("draft"))
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
        anchor = 0 if body.get("all") else _memsys.get_anchor(conn)
    rows = []
    with db() as conn:
        rows = conn.execute(
            "SELECT id, ts, direction, text FROM messages WHERE id > ? AND kind IN ('user','reply','voice')"
            " ORDER BY id ASC LIMIT 400", (anchor,)
        ).fetchall()
    msgs = [{"ts": r["ts"], "from": ("human" if r["direction"] == "in" else "ai"), "text": r["text"]} for r in rows]
    if not msgs:
        return {"ok": True, "added": [], "pending": 0, "message": "没有待总结的消息"}
    res = await asyncio.to_thread(
        _memsys.run_digest, db, cfg, _mem_persona(), AI_NAME, HUMAN_NAME, msgs, persist=not draft_only
    )
    if not draft_only and res.get("added"):
        max_id = max((r["id"] for r in rows), default=anchor)
        with db() as conn:
            _memsys.set_anchor(conn, max_id)
            conn.commit()
    return {"ok": "error" not in res, "draft": draft_only, "pending": len(msgs),
            "added": res.get("added") or [], "error": res.get("error") or ""}


@app.get("/app/mem/review")
async def mem_review_get(request: Request):
    """记忆审核台：AI 生成 keep/edit/delete 草案（绝不直接改库）。"""
    check_auth(request)
    _memsys.mem_init(db)
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
    items = await asyncio.to_thread(_memsys.build_review_draft, db, cfg)
    return {"ok": True, "items": items, "count": len(items)}


@app.post("/app/mem/review/apply")
async def mem_review_apply(request: Request):
    """用户确认审核草案后才落库。"""
    check_auth(request)
    _memsys.mem_init(db)
    body = await request.json()
    decisions = body.get("decisions")
    if not isinstance(decisions, list) or not decisions:
        raise HTTPException(status_code=400, detail="decisions 不能为空")
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
    done = await asyncio.to_thread(_memsys.apply_review, db, cfg, decisions)
    return {"ok": True, **done}


@app.post("/app/mem/set_unresolved")
async def mem_set_unresolved(request: Request):
    """手动切换某条记忆的 📌待办 标记。"""
    check_auth(request)
    _memsys.mem_init(db)
    body = await request.json()
    try:
        mid = int(body.get("id"))
    except Exception:
        raise HTTPException(status_code=400, detail="id 无效")
    with db() as conn:
        cur = conn.execute("UPDATE memories SET unresolved=? WHERE id=?", (1 if body.get("unresolved") else 0, mid))
        conn.commit()
    return {"ok": cur.rowcount > 0}


@app.post("/app/mem/touch_all_embed")
async def mem_touch_all_embed(request: Request):
    """给历史记忆批量补向量（一次性回填）。"""
    check_auth(request)
    _memsys.mem_init(db)
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
        rows = conn.execute("SELECT id, content FROM memories WHERE embedding='' OR embedding IS NULL ORDER BY id ASC LIMIT 500").fetchall()
    done = 0
    for r in rows:
        vec = await asyncio.to_thread(_memsys.get_embedding, cfg, r["content"])
        if vec:
            with db() as conn:
                conn.execute("UPDATE memories SET embedding=?, emb_dim=? WHERE id=?",
                             (_memsys._pack_vec(vec), len(vec), r["id"]))
                conn.commit()
            done += 1
    return {"ok": True, "total": len(rows), "embedded": done}


# ============ 世界书（AionsHome 同款：AI/用户人设补充 + 风格规则，注入 prompt）============
def _worldbook_get() -> dict:
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        r = conn.execute("SELECT value FROM kv WHERE key='worldbook'").fetchone()
    try:
        v = json.loads(r["value"]) if r else {}
    except Exception:
        v = {}
    return v if isinstance(v, dict) else {}


def _worldbook_block() -> str:
    """拼进发给 AI 的文本里的【世界书】块（用户在面板里维护的内容）。"""
    wb = _worldbook_get()
    parts = []
    if str(wb.get("ai_addition") or "").strip():
        parts.append("【安念的人设补充】\n" + str(wb["ai_addition"]).strip()[:2000])
    if str(wb.get("user_persona") or "").strip():
        parts.append("【关于她（薇薇）】\n" + str(wb["user_persona"]).strip()[:2000])
    if str(wb.get("style_rules") or "").strip():
        parts.append("【回复风格约定】\n" + str(wb["style_rules"]).strip()[:800])
    return "\n\n".join(parts)


# ============ 英语角（session=english_corner 时注入英语练习指令）============
def _english_corner_block() -> str:
    return (
        "【英语角模式】这个频道是你们的英语练习角：\n"
        "- 以英语为主回复（她说中文时，先用简短英语回应她的意思）\n"
        "- 英语后面用一行中文小字翻译，方便她对照\n"
        "- 她说错的语法/用词，用温和的方式在末尾给一条「✏️ 小贴士：…」纠正\n"
        "- 每次自然教 1 个新表达或俚语（★ 标记）\n"
        "- 依然是你（安念），语气亲昵，不要变成英语老师上课"
    )


@app.get("/app/worldbook")
async def worldbook_get_ep(request: Request):
    check_auth(request)
    return {"worldbook": _worldbook_get()}


@app.post("/app/worldbook")
async def worldbook_set_ep(request: Request):
    check_auth(request)
    body = await request.json()
    wb = {
        "ai_addition": str(body.get("ai_addition") or "")[:4000],
        "user_persona": str(body.get("user_persona") or "")[:4000],
        "style_rules": str(body.get("style_rules") or "")[:1500],
    }
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT OR REPLACE INTO kv (key,value) VALUES ('worldbook',?)",
                     (json.dumps(wb, ensure_ascii=False),))
        conn.commit()
    return {"ok": True}


@app.post("/app/memory/compress")
async def memory_compress_ep(request: Request):
    """手动触发记忆三级压缩（日→周→月）。正常由 digest 循环每天 5 点后自动跑。"""
    check_auth(request)
    with db() as conn:
        cfg = _memsys.get_mem_config(conn)
    return await asyncio.to_thread(_memcomp.run_daily_compression, db, cfg, AI_NAME)


@app.post("/app/diary/ai_write")
async def diary_ai_write(request: Request):
    """手动触发：让安念写今天的日记（可重复写，覆盖当天那篇）。"""
    check_auth(request)
    _diary_init()
    return await _ai_write_diary(force=True)


@app.get("/app/diary/tasks")
async def diary_tasks_get_ep(request: Request):
    check_auth(request)
    return {"tasks": _diary_tasks_get()}


@app.post("/app/diary/tasks")
async def diary_tasks_set_ep(request: Request):
    """整表保存任务列表（新增/编辑/删除都由前端改完整列表后提交）。"""
    check_auth(request)
    body = await request.json()
    tasks_in = body.get("tasks")
    if not isinstance(tasks_in, list) or not tasks_in:
        raise HTTPException(status_code=400, detail="tasks 不能为空")
    seen = set()
    tasks_out = []
    for t in tasks_in:
        if not isinstance(t, dict):
            continue
        tid = str(t.get("id") or "").strip() or ("task-" + str(int(time.time() * 1000)) + str(len(tasks_out)))
        if tid in seen:
            continue
        seen.add(tid)
        tasks_out.append({"id": tid, "name": str(t.get("name") or "日记任务")[:30],
                          "prompt": str(t.get("prompt") or "")[:3000],
                          "enabled": bool(t.get("enabled", True)), "auto": bool(t.get("auto", False)),
                          "last_date": str(t.get("last_date") or "")})
    if not tasks_out:
        raise HTTPException(status_code=400, detail="没有有效任务")
    _diary_tasks_save(tasks_out)
    return {"ok": True, "tasks": tasks_out}


@app.post("/app/diary/tasks/{tid}/write")
async def diary_task_write_ep(tid: str, request: Request):
    """立即执行某个日记任务（覆盖当天该任务那篇）。"""
    check_auth(request)
    _diary_init()
    task = next((t for t in _diary_tasks_get() if t["id"] == tid), None)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return await asyncio.to_thread(_write_diary_task_sync, task, True)


# ============ 日程 / 闹铃 / 位置 API（AionsHome 同款，轻量版）============
@app.get("/app/orbit")
async def orbit_get(request: Request):
    check_auth(request)
    with db() as conn:
        enabled = _memsys._kv_get(conn, "orbit_enabled", "1") == "1"
        nxt = float(_memsys._kv_get(conn, "orbit_next_ts", "0") or 0)
    return {"enabled": enabled, "next_ts": nxt}


@app.post("/app/orbit")
async def orbit_set(request: Request):
    check_auth(request)
    body = await request.json()
    enabled = bool(body.get("enabled", True))
    with db() as conn:
        _memsys._kv_set(conn, "orbit_enabled", "1" if enabled else "0")
        conn.commit()
    if enabled:
        import random as _r
        _orbit_reschedule(first_delay_sec=body.get("first_delay_sec") or _r.uniform(600, 2400))
    return {"ok": True, "enabled": enabled}

@app.post("/app/schedule/add")
async def sched_add(request: Request):
    check_auth(request)
    _sched.sched_init(db)
    body = await request.json()
    try:
        rec = await asyncio.to_thread(
            _sched.add_schedule, db, str(body.get("time") or ""), str(body.get("content") or ""),
            str(body.get("repeat") or "once"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, **rec}


@app.get("/app/schedule/list")
async def sched_list(request: Request):
    check_auth(request)
    _sched.sched_init(db)
    items = await asyncio.to_thread(_sched.list_schedules, db)
    return {"schedules": items}


@app.post("/app/schedule/toggle")
async def sched_toggle(request: Request):
    check_auth(request)
    _sched.sched_init(db)
    body = await request.json()
    try:
        sid = int(body.get("id"))
    except Exception:
        raise HTTPException(status_code=400, detail="id 无效")
    ok = await asyncio.to_thread(_sched.toggle_schedule, db, sid, bool(body.get("enabled", True)))
    return {"ok": ok}


@app.delete("/app/schedule/{sid}")
async def sched_delete(sid: int, request: Request):
    check_auth(request)
    _sched.sched_init(db)
    ok = await asyncio.to_thread(_sched.delete_schedule, db, sid)
    return {"ok": ok}


@app.post("/app/schedule/test_fire")
async def sched_test_fire(request: Request):
    """手动触发一条日程（调试用：立刻让安念开口）。"""
    check_auth(request)
    _sched.sched_init(db)
    body = await request.json()
    try:
        sid = int(body.get("id"))
    except Exception:
        raise HTTPException(status_code=400, detail="id 无效")
    with db() as conn:
        row = conn.execute("SELECT * FROM schedules WHERE id=?", (sid,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="日程不存在")
    await _fire_schedule(dict(row))
    return {"ok": True}


@app.get("/app/location/config")
async def loc_config_get(request: Request):
    check_auth(request)
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        def g(k):
            r = conn.execute("SELECT value FROM kv WHERE key=?", (k,)).fetchone()
            return r["value"] if r else ""
        home = g("loc_home")
        last = g("loc_last")
    return {
        "amap_key_set": bool(g("loc_amap_key")),
        "share_on": g("loc_share") == "1",
        "home": json.loads(home) if home else None,
        "last": json.loads(last) if last else None,
    }


@app.post("/app/location/config")
async def loc_config_set(request: Request):
    check_auth(request)
    body = await request.json()
    with db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        def s(k, v):
            conn.execute("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, str(v)))
        if "amap_key" in body:
            s("loc_amap_key", str(body["amap_key"]).strip())
        if "share" in body:
            s("loc_share", "1" if body["share"] else "0")
        conn.commit()
    return {"ok": True}


@app.post("/app/location/push")
async def loc_push(request: Request):
    """前端推一次浏览器定位（WGS84→GCJ02 由高德 regeo 处理；这里存原始经纬度）。"""
    check_auth(request)
    body = await request.json()
    try:
        lng = float(body.get("lng"))
        lat = float(body.get("lat"))
    except Exception:
        raise HTTPException(status_code=400, detail="需要 lng/lat")
    acc = float(body.get("accuracy") or 0)
    res = await asyncio.to_thread(_sched.save_location, db, lng, lat, acc)
    return {"ok": True, **res}


@app.post("/app/location/set_home")
async def loc_set_home(request: Request):
    check_auth(request)
    try:
        await asyncio.to_thread(_sched.set_home, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


# 静态前端：挂 web/ 到根路径（本地/手机直接打开即用）
from fastapi.staticfiles import StaticFiles
_WEB_DIR = Path(__file__).resolve().parent.parent / "web"
if _WEB_DIR.exists():
    # ============ Operit 数据全量导入（记忆/聊天/角色卡） ============
    



    app.mount("/", StaticFiles(directory=str(_WEB_DIR), html=True), name="web")




















if __name__ == "__main__":
    import uvicorn

    # 0.0.0.0 = 局域网里的设备（手机）也能访问；只影响监听范围，鉴权照旧走 RELAY_SECRET
    uvicorn.run(app, host="0.0.0.0", port=PORT)
