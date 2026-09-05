/* ════════════ 手机摄像头（getUserMedia直连） ════════════ */
let camStream = null;
let camTimer = null;

async function openCameraPanel(){
  const p = document.getElementById('cameraPanel');
  if (!p) return;
  p.classList.remove('hidden');
  p.setAttribute('aria-hidden', 'false');
}

function closeCameraPanel(){
  const p = document.getElementById('cameraPanel');
  if (!p) return;
  p.classList.add('hidden');
  p.setAttribute('aria-hidden', 'true');
  stopCamera();
}

async function startCamera(){
  const video = document.getElementById('camVideo');
  const statusEl = document.getElementById('camStatus');
  if (!video) return;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640 }, audio: false });
    video.srcObject = camStream;
    video.style.display = 'block';
    if (statusEl) statusEl.textContent = '🟢 摄像头已开启，安念在看';
    if (camTimer) clearInterval(camTimer);
    camTimer = setInterval(pushCamFrame, 5000);
    pushCamFrame();
  } catch(e){
    if (statusEl) statusEl.textContent = '🔴 打不开摄像头：' + e.message + '（需要HTTPS或localhost）';
  }
}

function stopCamera(){
  if (camTimer){ clearInterval(camTimer); camTimer = null; }
  if (camStream){
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  const video = document.getElementById('camVideo');
  if (video) video.style.display = 'none';
  const statusEl = document.getElementById('camStatus');
  if (statusEl) statusEl.textContent = '⚪ 摄像头未开启';
}

async function pushCamFrame(){
  const video = document.getElementById('camVideo');
  if (!video || !camStream) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const b64 = dataUrl.split(',', 1) && dataUrl.split(',')[1];
    if (!b64) return;
    await fetch(API_BASE + '/app/cam/push', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ b64: b64, note: '月光前端摄像头' })
    });
  } catch(e){}
}
