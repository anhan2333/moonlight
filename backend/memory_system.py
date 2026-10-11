# -*- coding: utf-8 -*-
"""
memory_system.py — 月光记忆系统（AionsHome 同款管线，stdlib-only）

能力：
  1. 真向量 embedding（硅基流动 BAAI/bge-m3，OpenAI 兼容 /embeddings）
  2. 综合评分召回：向量相似×0.6 + 关键词命中×0.3 + 重要度×0.1（门槛 0.45，Top5）
  3. 即时哨兵：每次发消息，小模型判断要不要查记忆/查什么词/要不要原文
  4. 背景记忆三层浮现：unresolved 待办优先 → 话题相关 → 近 3 天补满 8 条
  5. 记忆总结（手动/自动带锚点）：聊天 → 摘要+关键词+重要度+待办 → 向量化入库
  6. 记忆审核台：AI 只出草案 keep/edit/delete，用户确认后才落库（AionsHome 同款安全设计）

配置存 kv 表（与 models 配置同库同模式）：
  mem_embed_endpoint / mem_embed_key / mem_embed_model
  mem_sentinel_endpoint / mem_sentinel_key / mem_sentinel_model
未配置 embedding 时自动降级为现有关键词打分（不会更差）。
"""
from __future__ import annotations

import base64
import json
import math
import re
import struct
import time
import urllib.request
from datetime import datetime, timedelta, timezone

# ── 常量（AionsHome 同款权重）──────────────────────────────
VEC_W, KW_W, IMP_W = 0.6, 0.3, 0.1
# 0.45 是 AionsHome 短句记忆的门槛；月光的 OB 导入记忆偏长（标题+正文），
# 向量被稀释后 top 命中多在 0.36-0.42，故降到 0.34（仍取前5条按分排序，不降质）。
RECALL_THRESHOLD = 0.34
RECALL_TOP_K = 5
SURFACE_MAX = 8
EMBED_TIMEOUT = 20
SENTINEL_TIMEOUT = 25
DIGEST_MIN_MSGS = 30          # 自动总结：未总结消息 ≥ 30 条才触发
DIGEST_IDLE_MIN = 30          # 且用户已 30 分钟没说话
DIGEST_CHECK_SEC = 1800       # 每 30 分钟检查一次
DIGEST_GROUP = 30             # 每组 30 条消息串行提炼

DEFAULT_EMBED_ENDPOINT = "https://api.siliconflow.cn/v1"
DEFAULT_EMBED_MODEL = "BAAI/bge-m3"
DEFAULT_SENTINEL_MODEL = "Qwen/Qwen2.5-7B-Instruct"


# ── 配置读写（kv 表，由调用方传 db() 连接）─────────────────
def _kv_get(conn, key: str, default: str = "") -> str:
    try:
        r = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return (r["value"] if r else None) or default
    except Exception:
        return default


def _kv_set(conn, key: str, value: str) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute(
        "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def get_mem_config(conn) -> dict:
    return {
        "embed_endpoint": _kv_get(conn, "mem_embed_endpoint", DEFAULT_EMBED_ENDPOINT).rstrip("/"),
        "embed_key": _kv_get(conn, "mem_embed_key", ""),
        "embed_model": _kv_get(conn, "mem_embed_model", DEFAULT_EMBED_MODEL),
        "sentinel_endpoint": _kv_get(conn, "mem_sentinel_endpoint", DEFAULT_EMBED_ENDPOINT).rstrip("/"),
        "sentinel_key": _kv_get(conn, "mem_sentinel_key", "") or _kv_get(conn, "mem_embed_key", ""),
        "sentinel_model": _kv_get(conn, "mem_sentinel_model", DEFAULT_SENTINEL_MODEL),
    }


# ── 表结构迁移（幂等）─────────────────────────────────────
def mem_init(db) -> None:
    """db: callable returning sqlite3.Connection（与 app.db() 一致）"""
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT, importance INTEGER DEFAULT 5,
            arousal REAL DEFAULT 0.3, valence REAL DEFAULT 0.5,
            pinned INTEGER DEFAULT 0, created_at TEXT,
            last_activated TEXT, activation_count INTEGER DEFAULT 0,
            uuid TEXT DEFAULT '', reviewed INTEGER DEFAULT 1)""")
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(memories)").fetchall()}
        adds = {
            "embedding": "TEXT DEFAULT ''",           # float32 little-endian base64
            "keywords": "TEXT DEFAULT ''",            # JSON 数组
            "unresolved": "INTEGER DEFAULT 0",        # 📌 待办/悬而未决
            "mem_type": "TEXT DEFAULT 'event'",       # event/preference/promise/project
            "source_start_ts": "TEXT DEFAULT ''",     # 原文时间范围（追溯用）
            "source_end_ts": "TEXT DEFAULT ''",
            "emb_dim": "INTEGER DEFAULT 0",
            "updated_at": "TEXT DEFAULT ''",
        }
        for name, ddl in adds.items():
            if name not in cols:
                conn.execute(f"ALTER TABLE memories ADD COLUMN {name} {ddl}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_unresolved ON memories(unresolved)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_created ON memories(created_at)")
        conn.commit()


# ── embedding 工具 ─────────────────────────────────────────
def _pack_vec(vec: list[float]) -> str:
    return base64.b64encode(struct.pack(f"<{len(vec)}f", *vec)).decode("ascii")


def _unpack_vec(blob: str) -> list[float]:
    raw = base64.b64decode(blob)
    n = len(raw) // 4
    return list(struct.unpack(f"<{n}f", raw))


def _cosine(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for i in range(n):
        x, y = a[i], b[i]
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def get_embedding(cfg: dict, text: str) -> list[float] | None:
    """调 OpenAI 兼容 /embeddings。失败返回 None（调用方降级）。"""
    if not cfg.get("embed_key"):
        return None
    text = (text or "")[:2000]
    if not text.strip():
        return None
    payload = json.dumps({"model": cfg["embed_model"], "input": text}).encode("utf-8")
    req = urllib.request.Request(
        cfg["embed_endpoint"] + "/embeddings",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + cfg["embed_key"],
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=EMBED_TIMEOUT) as r:
            data = json.loads(r.read().decode("utf-8", "ignore"))
        vec = (data.get("data") or [{}])[0].get("embedding")
        return vec if isinstance(vec, list) and vec else None
    except Exception:
        return None


# ── 关键词命中分 ───────────────────────────────────────────
def _kw_list(raw) -> list[str]:
    try:
        v = json.loads(raw) if isinstance(raw, str) and raw.strip() else raw
        return [str(x) for x in v if x] if isinstance(v, list) else []
    except Exception:
        return []


def _keyword_score(query_kws: list[str], mem_kws_raw, content: str) -> float:
    if not query_kws:
        return 0.0
    mem_kws = _kw_list(mem_kws_raw)
    hay = (content or "") + " " + " ".join(mem_kws)
    hit = 0
    for w in query_kws:
        w = str(w).strip()
        if len(w) >= 2 and w in hay:
            hit += 1
    return min(1.0, hit / max(1, len(query_kws)))


# ── 综合评分召回（AionsHome 同款）──────────────────────────
def recall_memories(db, cfg: dict, query_text: str, query_keywords: list[str] | None = None,
                    top_k: int = RECALL_TOP_K, threshold: float = RECALL_THRESHOLD) -> list[dict]:
    query_keywords = query_keywords or []
    qvec = get_embedding(cfg, query_text) if cfg.get("embed_key") else None
    with db() as conn:
        rows = conn.execute(
            "SELECT id, content, importance, arousal, keywords, unresolved, mem_type, embedding, emb_dim,"
            " created_at, activation_count, source_start_ts, source_end_ts"
            " FROM memories WHERE archived=0 ORDER BY id DESC LIMIT 2000"
        ).fetchall()
    scored: list[dict] = []
    for row in rows:
        d = dict(row)
        vec_sim = 0.0
        if qvec and d.get("embedding"):
            try:
                mv = _unpack_vec(d["embedding"])
                vec_sim = max(0.0, _cosine(qvec, mv))
            except Exception:
                vec_sim = 0.0
        kw = _keyword_score(query_keywords, d.get("keywords"), d.get("content"))
        # 没有真向量时退化为：关键词直查内容 + 重要度（保证不比旧的差）
        if qvec is None:
            vec_sim = 0.0
            hay = (d.get("content") or "") + " " + " ".join(_kw_list(d.get("keywords")))
            if query_text and query_text in hay:
                vec_sim = 0.7
            else:
                # 逐个查询词命中内容：每个 +0.35（上限 0.8），让关键词召回也能过门槛
                for w in query_keywords:
                    w = str(w).strip()
                    if len(w) >= 2 and w in hay:
                        vec_sim = min(0.8, vec_sim + 0.35)
        imp = min(1.0, max(0.0, float(d.get("importance") or 5) / 10.0))
        final = vec_sim * VEC_W + kw * KW_W + imp * IMP_W
        d["score"] = round(final, 4)
        d["vec_sim"] = round(vec_sim, 4)
        d["kw_score"] = round(kw, 4)
        scored.append(d)
    scored.sort(key=lambda x: -x["score"])
    matched = [r for r in scored if r["score"] >= threshold][:top_k]
    # 激活计数 + last_activated（记忆被想起=强化）
    if matched:
        now = datetime.now(timezone.utc).isoformat()
        with db() as conn:
            for m in matched:
                conn.execute(
                    "UPDATE memories SET activation_count=activation_count+1, last_activated=? WHERE id=?",
                    (now, m["id"]),
                )
            conn.commit()
    return matched


# ── 背景记忆三层浮现（unresolved → 话题相关 → 近3天补满）──
def build_surfacing_memories(db, cfg: dict, topic: str, exclude_ids: set[int]) -> list[dict]:
    out: list[dict] = []
    used: set[int] = set()
    now_iso = datetime.now(timezone.utc).isoformat()
    with db() as conn:
        # ① unresolved 优先（最多 2 条）
        for r in conn.execute(
            "SELECT id, content, keywords, importance, mem_type, created_at FROM memories"
            " WHERE unresolved=1 AND archived=0 ORDER BY id DESC LIMIT 6"
        ).fetchall():
            d = dict(r)
            if d["id"] in exclude_ids or d["id"] in used:
                continue
            d["surface"] = "unresolved"
            out.append(d)
            used.add(d["id"])
            if len(out) >= 2:
                break
        # ② 话题相关（embedding 或关键词，Top3）
        if topic and len(out) < SURFACE_MAX:
            topic_kws = [w for w in re.split(r"[\s,，。;；、]+", topic) if len(w) >= 2][:6]
            qvec = get_embedding(cfg, topic) if cfg.get("embed_key") else None
            cand: list[dict] = []
            for r in conn.execute(
                "SELECT id, content, keywords, importance, mem_type, embedding, created_at FROM memories"
                " WHERE archived=0 ORDER BY id DESC LIMIT 1500"
            ).fetchall():
                d = dict(r)
                if d["id"] in exclude_ids or d["id"] in used:
                    continue
                s = 0.0
                if qvec and d.get("embedding"):
                    try:
                        s = max(s, _cosine(qvec, _unpack_vec(d["embedding"])))
                    except Exception:
                        pass
                s = max(s, _keyword_score(topic_kws, d.get("keywords"), d.get("content")) * 0.8)
                if s >= 0.5:
                    d["surface_sim"] = round(s, 3)
                    cand.append(d)
            cand.sort(key=lambda x: -x.get("surface_sim", 0))
            for d in cand[:3]:
                d["surface"] = "topic"
                out.append(d)
                used.add(d["id"])
        # ③ 近 3 天补充（补满 8 条）
        if len(out) < SURFACE_MAX:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
            for r in conn.execute(
                "SELECT id, content, keywords, importance, mem_type, created_at FROM memories"
                " WHERE created_at >= ? AND archived=0 ORDER BY id DESC LIMIT 20", (cutoff,)
            ).fetchall():
                d = dict(r)
                if d["id"] in exclude_ids or d["id"] in used:
                    continue
                d["surface"] = "recent"
                out.append(d)
                used.add(d["id"])
                if len(out) >= SURFACE_MAX:
                    break
    return out


def format_memory_block(recalled: list[dict], surfaced: list[dict]) -> str:
    """拼成注入 prompt 的记忆块（AionsHome 同款格式）。"""
    parts: list[str] = []
    if surfaced:
        lines = []
        for m in surfaced:
            tag = {"unresolved": "📌待办", "topic": "话题", "recent": "近期"}.get(m.get("surface"), "")
            kws = "、".join(_kw_list(m.get("keywords"))[:4])
            lines.append(f"- [{tag}] {m['content']}" + (f"（关键词：{kws}）" if kws else ""))
        parts.append("[背景记忆]\n" + "\n".join(lines))
    if recalled:
        lines = []
        for m in recalled:
            kws = "、".join(_kw_list(m.get("keywords"))[:4])
            lines.append(f"- {m['content']}" + (f"（关键词：{kws}）" if kws else ""))
        parts.append("[相关记忆]\n" + "\n".join(lines))
    return "\n\n".join(parts)


# ── 即时哨兵（小模型判断要不要查记忆）──────────────────────
def instant_digest(cfg: dict, recent_texts: list[str], current_text: str) -> dict:
    """返回 {is_search_needed, keywords, require_detail, topic, status}。失败给保守默认。"""
    fallback = {"is_search_needed": True, "keywords": [], "require_detail": False,
                "topic": current_text[:40], "status": ""}
    if not cfg.get("sentinel_key"):
        return fallback
    convo = "\n".join(f"- {t[:200]}" for t in recent_texts[-6:])
    prompt = (
        "你是记忆检索调度器。根据最近对话和当前消息，判断是否需要从长期记忆库检索。\n"
        f"最近对话：\n{convo}\n\n当前消息：{current_text[:300]}\n\n"
        '只输出 JSON（无 markdown）：{"is_search_needed":true/false,'
        '"keywords":["2-4个检索关键词"],"require_detail":true/false,'
        '"topic":"当前话题一句话","status":"用户当前情绪状态一句话或空"}\n'
        "规则：涉及过去的事/承诺/偏好/纪念日→true；纯寒暄/接话→false 但 topic 仍要填。"
    )
    payload = json.dumps({
        "model": cfg["sentinel_model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 220,
    }).encode("utf-8")
    req = urllib.request.Request(
        cfg["sentinel_endpoint"] + "/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + cfg["sentinel_key"]},
    )
    try:
        with urllib.request.urlopen(req, timeout=SENTINEL_TIMEOUT) as r:
            data = json.loads(r.read().decode("utf-8", "ignore"))
        raw = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        m = re.search(r"\{[\s\S]*\}", raw)
        obj = json.loads(m.group(0)) if m else {}
        kws = obj.get("keywords")
        return {
            "is_search_needed": bool(obj.get("is_search_needed", True)),
            "keywords": [str(x) for x in kws][:6] if isinstance(kws, list) else [],
            "require_detail": bool(obj.get("require_detail", False)),
            "topic": str(obj.get("topic") or current_text[:40]),
            "status": str(obj.get("status") or ""),
        }
    except Exception:
        return fallback


# ── 记忆总结（手动/自动共用，带锚点不重复）────────────────
def _extract_json_array(raw: str) -> list:
    m = re.search(r"\[[\s\S]*\]", raw or "")
    if not m:
        return []
    try:
        v = json.loads(m.group(0))
        return v if isinstance(v, list) else []
    except Exception:
        return []


def run_digest(db, cfg: dict, persona: str, ai_name: str, user_name: str,
               msgs: list[dict], *, persist: bool = True) -> dict:
    """
    msgs: [{ts, from, text}]（from: human/ai）。提炼成记忆条目。
    返回 {added:[...], raw}。persist=False 时只出草案（审核台用）。
    """
    if not msgs:
        return {"added": [], "raw": ""}
    convo = "\n".join(
        f"{(user_name if m['from'] == 'human' else ai_name)}（{str(m.get('ts',''))[:16]}）：{m['text'][:400]}"
        for m in msgs if (m.get("text") or "").strip()
    )
    if not convo.strip():
        return {"added": [], "raw": ""}
    prompt = (
        (persona + "\n\n" if persona else "") +
        f"你是 {ai_name} 的记忆整理模块。从下面对话中提炼值得长期记住的少量记忆（宁可0条，不凑数）。\n"
        "值得记：稳定偏好/雷区、关系事实、明确承诺或计划、重要情绪事件、长期项目、反复出现的模式。\n"
        "不要记：普通吃喝睡、寒暄、重复撒娇、一次性状态。\n"
        "每条记忆：content 短而干净（≤120字，第一人称视角记录她的事）、"
        "keywords 2-5个、importance 0-10、unresolved(true=待办/承诺未完成)、"
        "mem_type(event/preference/promise/project)、arousal 0-1 情绪强度、valence 0-1 正负向。\n"
        '只输出 JSON 数组：[{"content":"...","keywords":["..."],"importance":7,'
        '"unresolved":false,"mem_type":"event","arousal":0.5,"valence":0.7}]\n\n'
        f"对话：\n{convo[:12000]}"
    )
    if not cfg.get("sentinel_key"):
        return {"added": [], "raw": "", "error": "未配置总结模型（mem_sentinel_key）"}
    payload = json.dumps({
        "model": cfg["sentinel_model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 1500,
    }).encode("utf-8")
    req = urllib.request.Request(
        cfg["sentinel_endpoint"] + "/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + cfg["sentinel_key"]},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.loads(r.read().decode("utf-8", "ignore"))
        raw = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    except Exception as e:
        return {"added": [], "raw": "", "error": f"总结模型调用失败: {e}"}
    items = _extract_json_array(raw)
    added: list[dict] = []
    if not persist:
        return {"added": items, "raw": raw, "draft": True}
    now = datetime.now(timezone.utc).isoformat()
    start_ts = str(msgs[0].get("ts") or "")
    end_ts = str(msgs[-1].get("ts") or "")
    with db() as conn:
        for it in items:
            content = str(it.get("content") or "").strip()
            if not content:
                continue
            vec = get_embedding(cfg, content)
            emb = _pack_vec(vec) if vec else ""
            dim = len(vec) if vec else 0
            conn.execute(
                "INSERT INTO memories(content,importance,arousal,valence,pinned,created_at,last_activated,"
                "activation_count,uuid,reviewed,embedding,keywords,unresolved,mem_type,source_start_ts,"
                "source_end_ts,emb_dim,updated_at) VALUES(?,?,?,?,0,?,?,0,'',1,?,?,?,?,?,?,?,?)",
                (content,
                 max(1, min(10, int(it.get("importance") or 5))),
                 float(it.get("arousal") or 0.3), float(it.get("valence") or 0.5),
                 now, now,
                 json.dumps(vec is not None),
                 json.dumps([str(k) for k in (it.get("keywords") or [])][:6], ensure_ascii=False),
                 1 if it.get("unresolved") else 0,
                 str(it.get("mem_type") or "event"), start_ts, end_ts, dim, now),
            )
            cur_id = conn.execute("SELECT last_insert_rowid() AS i").fetchone()["i"]
            added.append({"id": cur_id, "content": content, "embedded": bool(vec)})
        conn.commit()
    return {"added": added, "raw": raw}


# ── 锚点（自动总结不重复处理同一批消息）───────────────────
def get_anchor(conn) -> int:
    v = _kv_get(conn, "mem_digest_anchor", "0")
    try:
        return int(v)
    except Exception:
        return 0


def set_anchor(conn, msg_id: int) -> None:
    _kv_set(conn, "mem_digest_anchor", str(int(msg_id)))


# ── 记忆审核台（AI 草案 → 用户确认 → 落库）────────────────
def build_review_draft(db, cfg: dict, limit: int = 120) -> list[dict]:
    """让模型对现有记忆出 keep/edit/delete 草案。绝不直接改库。"""
    with db() as conn:
        rows = conn.execute(
            "SELECT id, content, keywords, importance, unresolved, mem_type, created_at"
            " FROM memories WHERE archived=0 ORDER BY id ASC LIMIT ?", (limit,)
        ).fetchall()
    if not rows:
        return []
    numbered = [{"seq": f"M{i+1:04d}", **dict(r)} for i, r in enumerate(rows)]
    by_seq = {n["seq"]: n for n in numbered}
    batch_lines = "\n".join(
        json.dumps({"seq": n["seq"], "content": (n["content"] or "")[:900],
                    "keywords": n.get("keywords") or "", "importance": n.get("importance"),
                    "unresolved": bool(n.get("unresolved"))}, ensure_ascii=False)
        for n in numbered
    )
    prompt = (
        "你是记忆整理审核助手。你只是在给用户生成审核草案，绝不能声称已经修改或删除真实记忆。\n"
        "下面是记忆库的短摘要，每条有编号 seq，只能按已有 seq 输出建议。\n"
        "保守整理：关系事实/偏好/雷区/承诺/长期项目/情绪高光→keep；纯寒暄/明显重复/无信息量→delete；"
        "有价值但啰嗦→edit 并给更短新内容。\n"
        '只返回 JSON 数组：[{"seq":"M0001","action":"keep|edit|delete","content":"edit时的新内容否则空","reason":"简短理由"}]\n\n'
        f"记忆列表：\n{batch_lines}"
    )
    if not cfg.get("sentinel_key"):
        return [{**n, "suggested_action": "keep", "suggested_content": "", "reason": "未配置模型，默认不动",
                 "final_action": "keep", "final_content": n["content"]} for n in numbered]
    payload = json.dumps({
        "model": cfg["sentinel_model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2, "max_tokens": 3000,
    }).encode("utf-8")
    req = urllib.request.Request(
        cfg["sentinel_endpoint"] + "/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + cfg["sentinel_key"]},
    )
    suggestions: dict[str, dict] = {}
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read().decode("utf-8", "ignore"))
        raw = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        for s in _extract_json_array(raw):
            seq = str(s.get("seq") or "").strip()
            if seq in by_seq:
                suggestions[seq] = s
    except Exception:
        pass
    items = []
    for n in numbered:
        s = suggestions.get(n["seq"], {})
        action = str(s.get("action") or "keep")
        if action not in ("keep", "edit", "delete"):
            action = "keep"
        sug_content = str(s.get("content") or "").strip()
        if action == "edit" and not sug_content:
            action = "keep"
        items.append({
            "seq": n["seq"], "mem_id": n["id"],
            "original_content": n["content"], "original_keywords": n.get("keywords") or "",
            "original_importance": n.get("importance"), "original_unresolved": bool(n.get("unresolved")),
            "suggested_action": action,
            "suggested_content": sug_content if action == "edit" else "",
            "reason": str(s.get("reason") or ("模型没有建议这条，默认不动" if not s else "")),
            "final_action": action,
            "final_content": sug_content if action == "edit" else (n["content"] or ""),
        })
    return items


def apply_review(db, cfg: dict, decisions: list[dict]) -> dict:
    """用户确认后落库：decisions=[{mem_id, final_action, final_content}]"""
    done = {"edited": 0, "deleted": 0, "skipped": 0}
    now = datetime.now(timezone.utc).isoformat()
    with db() as conn:
        for d in decisions:
            try:
                mid = int(d.get("mem_id"))
            except Exception:
                done["skipped"] += 1
                continue
            act = str(d.get("final_action") or "keep")
            if act == "delete":
                conn.execute("DELETE FROM memories WHERE id=?", (mid,))
                done["deleted"] += 1
            elif act == "edit":
                content = str(d.get("final_content") or "").strip()
                if not content:
                    done["skipped"] += 1
                    continue
                vec = get_embedding(cfg, content)
                conn.execute(
                    "UPDATE memories SET content=?, embedding=?, emb_dim=?, updated_at=? WHERE id=?",
                    (content, _pack_vec(vec) if vec else "", len(vec) if vec else 0, now, mid),
                )
                done["edited"] += 1
            else:
                done["skipped"] += 1
        conn.commit()
    return done
