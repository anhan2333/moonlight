/* ════════════ 手机摄像头（getUserMedia + 拍照给安念看） ════════════ */
let camStream = null;

async function openCameraPanel(){
  const p = document.getElementById('cameraPanel');
  if (!p) return;
  p.classList.remove('hidden');
  p.setAttribute('aria-hidden','false');
  await startCamera();
}

function closeCameraPanel(){
  const p = document.getElementById('cameraPanel');
  if (!p) return;
  p.classList.add('hidden');
  p.setAttribute('aria-hidden','true');
  stopCamera();
}

async function startCamera(){
  const video = document.getElementById('camVideo');
  const status = document.getElementById('camStatus');
  if (!video) return;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    video.srcObject = camStream;
    video.play();
    if (status) status.textContent = '摄像头已开启——安念在看你了';
  } catch(e){
    if (status) status.textContent = '无法开启摄像头：' + (e.message || e.name) + '（localhost或HTTPS环境可用）';
  }
}

function stopCamera(){
  if (camStream){
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
}

function flipCamera(){
  if (!camStream) return;
  const video = document.getElementById('camVideo');
  const cur = video.srcObject.getVideoTracks()[0];
  const facing = cur.getSettings().facingMode || 'user';
  stopCamera();
  startCameraWithMode(facing === 'user' ? 'environment' : 'user');
}

async function startCameraWithMode(mode){
  const video = document.getElementById('camVideo');
  const status = document.getElementById('camStatus');
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false });
    video.srcObject = camStream;
    video.play();
    if (status) status.textContent = '已切换镜头';
  } catch(e){
    if (status) status.textContent = '切换失败：' + (e.message || e.name);
  }
}

function snapCamera(){
  const video = document.getElementById('camVideo');
  const canvas = document.getElementById('camCanvas');
  const status = document.getElementById('camStatus');
  if (!video || !canvas || !camStream){ return; }
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const note = (document.getElementById('camNote')||{}).value || '';
  const preview = document.getElementById('camPreview');
  if (preview){
    preview.innerHTML = '<img src="' + dataUrl + '" style="max-width:100%;border-radius:12px;border:1px solid rgba(189,160,111,.3);">';
  }
  if (status) status.textContent = '拍好了，正在发给安念…';
  fetch(API_BASE + '/app/camera/upload', {
    method: 'POST',
    headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
    body: JSON.stringify({ image: dataUrl, note: note })
  }).then(r => r.json()).then(d => {
    if (d.ok){
      if (status) status.textContent = '安念收到了 ✓';
      loadCameraGallery();
    } else {
      if (status) status.textContent = '发送失败：' + (d.detail || d.error || '未知错误');
    }
  }).catch(() => {
    if (status) status.textContent = '发送失败：网络错误';
  });
}

async function loadCameraGallery(){
  const box = document.getElementById('camGallery');
  if (!box) return;
  try {
    const r = await fetch(API_BASE + '/app/camera/photos', { headers: authHeaders() });
    const data = await r.json();
    if (data.photos && data.photos.length){
      box.innerHTML = data.photos.map(u => '<img src="' + API_BASE + u + '" style="width:44%;margin:2%;border-radius:10px;border:1px solid rgba(189,160,111,.2);">').join('');
    } else {
      box.innerHTML = '<div class="panel-loading">还没有照片</div>';
    }
  } catch(e){
    box.innerHTML = '<div class="panel-loading">加载失败</div>';
  }
}