# -*- coding: utf-8 -*-
"""本地 ASR 服务（SenseVoice-Small，CPU 推理，端口 3021）。"""
import os
os.environ.setdefault("MODELSCOPE_CACHE", os.path.expanduser("~/.cache/modelscope"))
import re
import tempfile
import subprocess
import time
import asyncio
from fastapi import FastAPI, UploadFile, File
import uvicorn

app = FastAPI(title="Local ASR (SenseVoice)")
_model = None
_infer_lock = asyncio.Lock()   # 串行化推理：并发请求排队，互不踩踏

def get_model():
    global _model
    if _model is None:
        from funasr import AutoModel
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
        _model = AutoModel(
            model="iic/SenseVoiceSmall",
            vad_model="fsmn-vad",
            vad_kwargs={"max_single_segment_time": 30000},
            device="cpu",
        )
        _model._postprocess = rich_transcription_postprocess
    return _model

def to_wav16k(src_path: str) -> str:
    """ffmpeg 解码任意容器 → 16k wav。"""
    wav_path = src_path + ".16k.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src_path,
         "-ar", "16000", "-ac", "1", wav_path],
        check=True, timeout=60,
    )
    return wav_path

@app.post("/asr")
async def asr(file: UploadFile = File(...)):
    t0 = time.time()
    audio = await file.read()
    tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    tmp.write(audio)
    tmp.close()
    wav_path = None
    try:
        wav_path = to_wav16k(tmp.name)
        model = get_model()
        async with _infer_lock:
            # funasr generate 是阻塞调用：丢进线程池跑，事件循环不再被卡死
            res = await asyncio.to_thread(
                model.generate,
                input=wav_path, cache={}, language="zh", use_itn=True,
                batch_size_s=60, merge_vad=True, merge_length_s=15,
            )
        raw = res[0]["text"] if res else ""
        text = model._postprocess(raw) if raw else ""
        text = re.sub(r"<\|[^|]+\|>", "", text).strip()
        if text and not re.search(r"[一-龥a-zA-Z0-9]", text):
            text = ""
        elapsed = round((time.time() - t0) * 1000)
        return {"text": text, "ms": elapsed, "lang": "zh"}
    finally:
        for fp in (tmp.name, wav_path):
            if fp:
                try: os.unlink(fp)
                except OSError: pass

@app.get("/healthz")
def healthz():
    return {"ok": True}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=3021)
