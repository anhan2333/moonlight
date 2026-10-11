#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""离线 ASR 对比:SenseVoice(本地) vs qwen3-omni-flash(DashScope)。
拿现有通话录音片段,比转写结果和耗时。只读样本,不改任何配置。
用法: python3 asr_compare.py [N=4]
"""
import sys, os, glob, json, time, base64, subprocess, urllib.request

N = int(sys.argv[1]) if len(sys.argv) > 1 else 4
UPLOADS = "/home/weiwei/services/moonlight/backend/uploads"
TOOL = "/home/weiwei/services/moonlight/backend/tools/sensevoice_cli.py"
ENV = "/home/weiwei/services/moonlight/backend/relay.env"

def env_key(k):
    for line in open(ENV, encoding="utf-8"):
        if line.startswith(k + "="):
            return line.split("=", 1)[1].strip()
    return ""

def load_env():
    d = {}
    for line in open(ENV, encoding="utf-8"):
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.strip().partition("=")
            d[k] = v
    return d

E = load_env()

# 取最大的 N 个语音片段(大的更可能是完整句子)
files = sorted(glob.glob(os.path.join(UPLOADS, "voice*")), key=os.path.getsize, reverse=True)[:N]
files = [f for f in files if os.path.getsize(f) > 4000]  # 跳过太短的(本就是噪声)
print(f"样本 {len(files)} 个:", flush=True)

def sensevoice(path):
    t0 = time.time()
    r = subprocess.run(["python3", TOOL, path, "audio/webm"], capture_output=True, text=True, timeout=120)
    return (r.stdout or "").strip(), time.time() - t0

def qwen_omni(path, key):
    t0 = time.time()
    b64 = base64.b64encode(open(path, "rb").read()).decode()
    payload = json.dumps({"model": "qwen3-omni-flash", "messages": [{"role": "user", "content": [
        {"type": "input_audio", "input_audio": {"data": "data:audio/wav;base64," + b64, "format": "wav"}},
        {"type": "text", "text": "逐字转写,只输出转写文本"}]}]}).encode()
    req = urllib.request.Request("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                                 data=payload, headers={"Content-Type": "application/json",
                                                        "Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read().decode())
        txt = (((d.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        return txt, time.time() - t0
    except Exception as e:
        try:
            detail = e.read().decode(errors="replace")[:100]
        except Exception:
            detail = str(e)
        return f"[失败 {detail}]", time.time() - t0

dash_key = E.get("DASHSCOPE_API_KEY", "")
sv_total = q_total = 0.0
for i, f in enumerate(files, 1):
    size_kb = os.path.getsize(f) // 1024
    sv_text, sv_t = sensevoice(f)
    sv_total += sv_t
    qw_text, qw_t = (qwen_omni(f, dash_key) if dash_key else ("[无 DASHSCOPE_API_KEY]", 0))
    q_total += qw_t
    print(f"\n── 片段{i} {os.path.basename(f)} ({size_kb}KB)", flush=True)
    print(f"  SenseVoice(本地) {sv_t:5.1f}s: {sv_text[:80] or '(空)'}", flush=True)
    print(f"  qwen3-omni(云端) {qw_t:5.1f}s: {qw_text[:80] or '(空)'}", flush=True)

print(f"\n=== 合计: SenseVoice {sv_total:.1f}s / qwen3-omni {q_total:.1f}s ({len(files)} 个片段)", flush=True)
print("=== SenseVoice 一次加载约 3-5s 常驻后单条会更快(上面首条含冷启动)", flush=True)
