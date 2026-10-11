# memory_compression.py — 月光版记忆日历压缩（对齐 AionsHome 三级：日→周→月）
#
# 设计：
# - 每条原始记忆 compression_stage=0；压缩产出胶囊 stage=1/2/3（day/week/month）。
# - 原件不删，标 archived=1 归档（可追溯、可恢复）；召回/浮现只读 archived=0。
# - 每天凌晨 5 点（DAY_START_HOUR，与上游一致）把"昨天及更早"的未压缩记忆逐级压缩。
# - 幂等：同一 period 只压一次（period_key 去重）；补跑：漏掉的天会在下次运行时补上。
import json
import re
import urllib.request
from datetime import datetime, timedelta, timezone

DAY_START_HOUR = 5  # 一天的边界在凌晨 5 点（上游同款：聊天记录意义上的"一天"）

LEVELS = {
    "daily":   {"src_stage": 0, "out_stage": 1, "kind": "day",   "title": "每日记忆"},
    "weekly":  {"src_stage": 1, "out_stage": 2, "kind": "week",  "title": "每周记忆"},
    "monthly": {"src_stage": 2, "out_stage": 3, "kind": "month", "title": "每月记忆"},
}


# ── 表结构迁移（幂等）─────────────────────────────────────
def ensure_schema(db) -> None:
    """给 memories 表补压缩/归档列。db: callable returning sqlite3.Connection"""
    with db() as conn:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(memories)").fetchall()}
        adds = {
            "compression_stage": "INTEGER DEFAULT 0",   # 0=原始 1=日胶囊 2=周胶囊 3=月胶囊
            "archived": "INTEGER DEFAULT 0",            # 1=已被压缩归档（召回不读，但不删）
            "period_key": "TEXT DEFAULT ''",            # 如 2026-09-15 / 2026-W38 / 2026-09
            "period_title": "TEXT DEFAULT ''",          # 胶囊标题（模型生成）
        }
        for name, ddl in adds.items():
            if name not in cols:
                conn.execute(f"ALTER TABLE memories ADD COLUMN {name} {ddl}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_archived ON memories(archived)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_stage ON memories(compression_stage, period_key)")
        conn.commit()


# ── 周期切分（日界在凌晨 5 点）─────────────────────────────
def _parse_ts(s: str) -> datetime | None:
    """created_at 是 ISO 字符串（可能带时区）。失败返回 None。"""
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone()
    except Exception:
        return None


def period_key_for(ts_str: str, kind: str) -> str:
    """把 ISO 时间戳归到压缩周期：day=2026-09-15（凌晨5点界）/ week=2026-W38 / month=2026-09。"""
    dt = _parse_ts(ts_str)
    if not dt:
        return ""
    shifted = dt - timedelta(hours=DAY_START_HOUR)
    if kind == "day":
        return shifted.strftime("%Y-%m-%d")
    if kind == "week":
        iso = shifted.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    if kind == "month":
        return shifted.strftime("%Y-%m")
    return ""


def current_period_key(kind: str) -> str:
    return period_key_for(datetime.now(timezone.utc).isoformat(), kind)


def parent_period_key(child_key: str, parent_kind: str) -> str:
    """子周期 key → 父周期 key：day(2026-09-08)→week(2026-W37)；week→month(2026-09)。
    day key 已含凌晨 5 点偏移，直接按日历日解析即可。"""
    try:
        if parent_kind == "week":
            d = datetime.strptime(child_key, "%Y-%m-%d")
            iso = d.isocalendar()
            return f"{iso.year}-W{iso.week:02d}"
        if parent_kind == "month":
            # 周归属其周一所在月（ISO 惯例）
            d = datetime.strptime(child_key + "-1", "%G-W%V-%u")
            return d.strftime("%Y-%m")
    except Exception:
        return ""
    return ""


# ── 模型调用（复用总结模型 sentinel 配置）────────────────────
def _call_model(cfg: dict, prompt: str, max_tokens: int = 1200) -> str:
    if not cfg.get("sentinel_key"):
        raise RuntimeError("未配置总结模型（mem_sentinel_key）")
    payload = json.dumps({
        "model": cfg["sentinel_model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": max_tokens,
    }).encode("utf-8")
    req = urllib.request.Request(
        cfg["sentinel_endpoint"] + "/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + cfg["sentinel_key"]},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8", "ignore"))
    return ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""


def _extract_json_obj(raw: str) -> dict:
    m = re.search(r"\{[\s\S]*\}", raw or "")
    if not m:
        return {}
    try:
        v = json.loads(m.group(0))
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


# ── 压缩一个周期 ───────────────────────────────────────────
def _source_rows_for(db, level: str, parent_key: str) -> list:
    """取某层级某父周期下的所有未归档源记忆。
    daily: 源=原始记忆，period_key 就是 day key；
    weekly/monthly: 源=日/周胶囊，其 period_key 是子周期 key，需映射到父周期比较。"""
    lv = LEVELS[level]
    child_kind = {"daily": None, "weekly": "week", "monthly": "month"}[level]
    with db() as conn:
        if child_kind is None:
            return conn.execute(
                "SELECT id, content, importance, mem_type, created_at FROM memories"
                " WHERE compression_stage=? AND period_key=? AND archived=0 ORDER BY id ASC",
                (lv["src_stage"], parent_key),
            ).fetchall()
        rows = conn.execute(
            "SELECT id, content, importance, mem_type, created_at, period_key FROM memories"
            " WHERE compression_stage=? AND archived=0 AND period_key != '' ORDER BY id ASC",
            (lv["src_stage"],),
        ).fetchall()
    return [r for r in rows if parent_period_key(r["period_key"], child_kind) == parent_key]


def compress_period(db, cfg: dict, level: str, period_key: str, ai_name: str = "安念") -> dict:
    """把某层级某周期的所有未归档记忆压成一条胶囊。幂等：已压过就跳过。"""
    lv = LEVELS[level]
    with db() as conn:
        # 幂等：该周期已有产出胶囊就跳过
        dup = conn.execute(
            "SELECT id FROM memories WHERE compression_stage=? AND period_key=? AND archived=0",
            (lv["out_stage"], period_key),
        ).fetchone()
        if dup:
            return {"level": level, "period": period_key, "skipped": "already-compressed", "id": dup["id"]}
    rows = _source_rows_for(db, level, period_key)
    if not rows:
        return {"level": level, "period": period_key, "skipped": "empty"}

    src_desc = {"day": "原始记忆", "week": "每日胶囊", "month": "每周胶囊"}[lv["kind"]]
    lines = "\n".join(f"- [{r['mem_type']}|重要度{r['importance']}] {r['content']}" for r in rows)
    prompt = (
        f"你是 {ai_name} 的记忆压缩模块。把「{period_key}」这个{lv['title'].replace('记忆','')}的{src_desc}"
        f"压缩成一条{lv['title']}胶囊。\n"
        "要求：保留所有长期有效的事实（偏好/承诺/计划/关系事实/未完成的待办），丢掉一次性细节；"
        "第一人称视角；正文≤200字；标题≤15字；unresolved=true 当且仅当里面有未完成的承诺/待办。\n"
        '只输出 JSON：{"title":"...","content":"...","importance":7,"unresolved":false}\n\n'
        f"待压缩的{src_desc}（共{len(rows)}条）：\n{lines[:9000]}"
    )
    try:
        obj = _extract_json_obj(_call_model(cfg, prompt))
    except Exception as e:
        return {"level": level, "period": period_key, "error": str(e)}
    content = str(obj.get("content") or "").strip()
    if not content:
        return {"level": level, "period": period_key, "error": "模型没产出内容"}
    title = str(obj.get("title") or "").strip()[:15] or f"{period_key} {lv['title']}"
    importance = max(1, min(10, int(obj.get("importance") or 7)))
    unresolved = 1 if obj.get("unresolved") else 0

    now = datetime.now(timezone.utc).isoformat()
    start_ts = rows[0]["created_at"] or ""
    end_ts = rows[-1]["created_at"] or ""
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO memories(content,importance,arousal,valence,pinned,created_at,last_activated,"
            "activation_count,uuid,reviewed,embedding,keywords,unresolved,mem_type,source_start_ts,"
            "source_end_ts,emb_dim,updated_at,compression_stage,archived,period_key,period_title)"
            " VALUES(?,?,0.3,0.5,0,?,?,0,'',1,'','[]',?,'compressed',?,?,0,?,?,0,?,?)",
            (content, importance, now, now,
             unresolved, start_ts, end_ts, now,
             lv["out_stage"], period_key, title),
        )
        new_id = cur.lastrowid
        ids = [r["id"] for r in rows]
        conn.execute(
            f"UPDATE memories SET archived=1, updated_at=? WHERE id IN ({','.join('?' * len(ids))})",
            [now] + ids,
        )
        conn.commit()
    return {"level": level, "period": period_key, "id": new_id, "title": title,
            "compressed": len(rows), "words": len(content)}


def list_pending_periods(db, level: str) -> list[str]:
    """列出某层级所有「有未归档源记忆、且周期已结束」的周期 key。
    daily 直接用 day key；weekly/monthly 由源胶囊的子周期 key 映射出父周期。"""
    lv = LEVELS[level]
    cur_key = current_period_key(lv["kind"])
    with db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT period_key FROM memories"
            " WHERE compression_stage=? AND archived=0 AND period_key != ''",
            (lv["src_stage"],),
        ).fetchall()
    if level == "daily":
        return sorted(r["period_key"] for r in rows if r["period_key"] < cur_key)
    parent_kind = "week" if level == "weekly" else "month"
    keys = {parent_period_key(r["period_key"], parent_kind) for r in rows}
    return sorted(k for k in keys if k and k < cur_key)


def backfill_period_keys(db) -> int:
    """给历史记忆补 period_key（按 created_at 推算）。返回补了的条数。"""
    n = 0
    with db() as conn:
        rows = conn.execute(
            "SELECT id, created_at, compression_stage FROM memories WHERE period_key=''"
        ).fetchall()
        for r in rows:
            stage = r["compression_stage"] or 0
            kind = {0: "day", 1: "day", 2: "week", 3: "month"}.get(stage, "day")
            # stage≥1 的胶囊按产出周期归属；原始记忆按天归属
            pk = period_key_for(r["created_at"] or "", "day" if stage == 0 else kind)
            if pk:
                conn.execute("UPDATE memories SET period_key=? WHERE id=?", (pk, r["id"]))
                n += 1
        conn.commit()
    return n


def run_daily_compression(db, cfg: dict, ai_name: str = "安念") -> dict:
    """每天跑一次：先补 period_key，再逐级（日→周→月）压缩所有到期周期。"""
    ensure_schema(db)
    backfilled = backfill_period_keys(db)
    results = []
    for level in ("daily", "weekly", "monthly"):
        for pk in list_pending_periods(db, level):
            results.append(compress_period(db, cfg, level, pk, ai_name))
    return {"backfilled": backfilled, "ran": len(results), "results": results}
