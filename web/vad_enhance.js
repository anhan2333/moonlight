/* ============================================================
 * vad_enhance.js · 月光语音增强（pai-voice 优点移植版）
 * ------------------------------------------------------------
 * 只加不改：不修改 index.html 的任何现有逻辑，只在其上叠加：
 *   1) 自适应双阈值 VAD（pai-voice 核心算法）：
 *      动态噪声底 + 进/出双阈值 + 看门狗，环境噪声抬升不卡死。
 *   2) 说完自动发送（endSilenceMs=650 静音自动结束录音）：
 *      语音面板录音时不用再手动点「结束」；面板里有开关可关。
 *   3) 温和打断（bargeInMs=820）：
 *      安念正在朗读时，你持续开口 0.8 秒才停下他——轻声附和、
 *      呼吸声不会误触（呼吸是短促的，真说话撑得过 0.8s）。
 * 参数取自 pai-voice voice-call.js 的实战调校值。
 * ============================================================ */
(function () {
  "use strict";
  if (window.__moonVad) return;           // 幂等

  /* ── 参数（pai-voice 实战值） ── */
  const CFG = {
    startHold: 3,          // 连续几块(~60ms/块)超阈值算开口
    endSilenceMs: 650,     // 静音多久算说完 → 自动发送
    bargeInMs: 820,        // 正在播放时，持续开口多久才打断
    floor: 0.006,          // 最低噪声底
    gain: 3.2,             // 进入阈值 = max(floor, 噪声底 * gain)
    exitRatio: 0.62,       // 结束阈值 = 进入阈值 * 这个（双阈值防悬停）
    speakingGain: 3.3,     // AI 说话时再提高门槛，降扬声器/呼吸误触
    watchdogMs: 1600       // 这么久没有真语音峰值 → 强制收尾（AGC 抬底噪也不卡）
  };

  /* ── 状态 ── */
  let ctx = null, analyser = null, bufF = null, bufB = null;
  let noise = 0.01, speechMin = 1;
  let hot = 0, hotSince = 0, silenceSince = 0, lastHotAt = 0;
  let speaking = false, monitoring = false, rafId = 0, watchTimer = 0;

  const AUTO_KEY = "vad_auto_end";
  function autoEndOn() {
    try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch (e) { return true; }
  }
  function setAutoEnd(v) {
    try { v ? localStorage.removeItem(AUTO_KEY) : localStorage.setItem(AUTO_KEY, "0"); } catch (e) {}
  }

  /* ── AI 是否正在朗读（三个播放通道任一） ── */
  function aiTalking() {
    try { if (typeof _vcAudio !== "undefined" && _vcAudio && !_vcAudio.paused) return true; } catch (e) {}
    try { if (window.__moonAudio && !window.__moonAudio.paused) return true; } catch (e) {}
    try { if ("speechSynthesis" in window && (speechSynthesis.speaking || speechSynthesis.pending)) return true; } catch (e) {}
    return false;
  }

  /* ── 温和打断：停掉所有正在播的声音 ── */
  function bargeIn() {
    try { if (typeof _vcAudio !== "undefined" && _vcAudio && !_vcAudio.paused) _vcAudio.pause(); } catch (e) {}
    try { if (window.__moonAudio && !window.__moonAudio.paused) window.__moonAudio.pause(); } catch (e) {}
    try { if ("speechSynthesis" in window && speechSynthesis.speaking) speechSynthesis.cancel(); } catch (e) {}
  }

  /* ── 自动收尾：等同用户点「结束」（stopRecording(true) 是 index.html 的全局函数） ── */
  function autoEnd() {
    try {
      if (typeof stopRecording === "function" && typeof isRecording !== "undefined" && isRecording) {
        stopRecording(true);
      }
    } catch (e) {}
  }

  /* ── VAD 事件 ── */
  function onSpeechStart(aiWasTalking) {
    speaking = true;
    speechMin = 1; silenceSince = 0;
    lastHotAt = performance.now();
    if (aiWasTalking) bargeIn();          // 温和打断：只拦正式播放，思考/短提示音不拦
  }
  function onSpeechEnd() {
    speaking = false; silenceSince = 0; hot = 0; hotSince = 0;
    if (autoEndOn() && typeof voiceMode !== "undefined" && voiceMode) autoEnd();
  }

  /* ── RMS 读取（Float 优先，Byte 兼容老 Safari） ── */
  function readRms() {
    if (analyser.getFloatTimeDomainData) {
      analyser.getFloatTimeDomainData(bufF);
      let s = 0; for (let i = 0; i < bufF.length; i++) s += bufF[i] * bufF[i];
      return Math.sqrt(s / bufF.length);
    }
    analyser.getByteTimeDomainData(bufB);
    let s = 0; for (let i = 0; i < bufB.length; i++) { const v = (bufB[i] - 128) / 128; s += v * v; }
    return Math.sqrt(s / bufB.length);
  }

  /* ── 主循环：pai-voice 双阈值自适应 VAD ── */
  function loop() {
    if (!monitoring || !analyser) return;
    const rms = readRms();
    const now = performance.now();

    // 噪声底：没说话时快跟；说话中也向观测最小值慢慢靠（AGC 抬底噪时不卡死）
    if (!speaking) noise = noise * 0.97 + rms * 0.03;
    else { speechMin = Math.min(speechMin, rms); noise = Math.min(noise * 1.0015, Math.max(noise, speechMin)); }

    let enter = Math.max(CFG.floor, noise * CFG.gain);
    const aiSpk = aiTalking();
    if (aiSpk) enter *= CFG.speakingGain;
    const exit = enter * CFG.exitRatio;

    if (rms > enter) lastHotAt = now;

    if (!speaking) {
      if (rms > enter) {
        hot += 1;
        if (!hotSince) hotSince = now;
        if (hot >= CFG.startHold) {
          const needed = aiSpk ? CFG.bargeInMs : 0;   // 打断要撑过 0.8s
          if (now - hotSince >= needed) onSpeechStart(aiSpk);
        }
      } else { hot = 0; hotSince = 0; }
    } else {
      if (rms < exit) {
        if (!silenceSince) silenceSince = now;
        else if (now - silenceSince >= CFG.endSilenceMs) { onSpeechEnd(); }
      } else {
        silenceSince = 0;
      }
      if (lastHotAt && now - lastHotAt >= CFG.watchdogMs) onSpeechEnd();
    }
    rafId = requestAnimationFrame(loop);
  }

  /* ── 挂载/卸载分析器（mediaStream 是 index.html 的全局变量，开麦后动态接上） ── */
  function attach() {
    if (monitoring) return;
    let ms = null;
    try { if (typeof mediaStream !== "undefined") ms = mediaStream; } catch (e) { return; }
    if (!ms || !ms.getAudioTracks().length) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(new MediaStream([ms.getAudioTracks()[0]]));
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);                 // 不接 destination：避免自己听见自己
      bufF = new Float32Array(analyser.fftSize);
      bufB = new Uint8Array(analyser.fftSize);
      monitoring = true;
      noise = 0.01; speaking = false; hot = 0; hotSince = 0; silenceSince = 0;
      rafId = requestAnimationFrame(loop);
    } catch (e) {}
  }
  function detach() {
    monitoring = false;
    if (rafId) cancelAnimationFrame(rafId); rafId = 0;
    try { if (analyser) analyser.disconnect(); } catch (e) {}
    analyser = null;
    speaking = false;
  }

  // 每 400ms 巡检：开麦了就挂分析，录音停了就摘（现有代码每次录音会重建 mediaStream）
  watchTimer = setInterval(() => {
    let ms = null;
    try { if (typeof mediaStream !== "undefined") ms = mediaStream; } catch (e) {}
    if (ms && ms.getAudioTracks && ms.getAudioTracks().length) {
      if (!monitoring) attach();
      else {
        // 流被替换了（旧轨已 stop）→ 重新挂
        const t = ms.getAudioTracks()[0];
        if (!t || t.readyState !== "live") { detach(); attach(); }
      }
    } else if (monitoring) detach();
  }, 400);

  /* ── 语音面板里的「自动分段」开关（纯新增按钮，不动现有 DOM 结构） ── */
  function injectSwitch() {
    const box = document.querySelector("#inputVoice .voice-actions");
    if (!box || document.getElementById("vadAutoEndBtn")) return;
    const b = document.createElement("button");
    b.id = "vadAutoEndBtn";
    b.className = "voice-cancel";
    b.type = "button";
    b.style.flex = "1 1 100%";
    b.style.order = "-1";
    b.style.marginBottom = "2px";
    b.textContent = "✨ 说完自动发送：开";
    b.addEventListener("click", () => {
      const next = !autoEndOn();
      setAutoEnd(next);
      b.textContent = next ? "✨ 说完自动发送：开" : "✨ 说完自动发送：关";
    });
    box.insertBefore(b, box.firstChild);
  }
  const _mo = new MutationObserver(() => injectSwitch());
  function startObserver() {
    const v = document.getElementById("inputVoice");
    if (v) { _mo.observe(v, { childList: true, subtree: true }); injectSwitch(); }
    else setTimeout(startObserver, 800);
  }
  startObserver();

  window.__moonVad = { cfg: CFG, detach, attach, autoEndOn, setAutoEnd };
})();
