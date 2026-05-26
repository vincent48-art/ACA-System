// app.js – Shared utilities, auth, offline sync, audit logging, PDF export, notifications, AI analysis

// ---------- AUTH ----------
function checkAuth(requiredRoles = []) {
  return new Promise((resolve, reject) => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      unsubscribe();
      if (!user) { window.location.href = 'index.html'; reject('Not authenticated'); return; }
      const cachedRole = localStorage.getItem('acfms_user_role');
      let role = cachedRole;
      if (!role) {
        try {
          const doc = await db.collection('users').doc(user.uid).get();
          role = doc.exists ? doc.data().role : 'officer';
          localStorage.setItem('acfms_user_role', role);
        } catch (e) { window.location.href = 'index.html'; reject(e); return; }
      }
      if (requiredRoles.length && !requiredRoles.includes(role)) {
        window.location.href = 'index.html'; reject('Insufficient permissions'); return;
      }
      resolve({ user, role });
    });
  });
}

function logout() {
  logAction('logout');
  auth.signOut().then(() => {
    localStorage.removeItem('acfms_user_role');
    localStorage.removeItem('acfms_user_uid');
    window.location.href = 'index.html';
  });
}

// ---------- AUDIT LOGGING ----------
function logAction(action, details = {}) {
  const user = auth.currentUser;
  if (!user) return;
  db.collection('logs').add({
    userId: user.uid,
    email: user.email,
    action,
    details,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch(err => console.error('Log failed:', err));
}

// ---------- OFFLINE HANDLING ----------
function saveReportOffline(reportData) {
  const pending = JSON.parse(localStorage.getItem('acfms_pending_reports') || '[]');
  pending.push({ ...reportData, pendingId: Date.now().toString(), createdAt: new Date().toISOString() });
  localStorage.setItem('acfms_pending_reports', JSON.stringify(pending));
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then(sw => sw.sync.register('sync-reports'));
  } else { syncPendingReports(); }
}

async function syncPendingReports() {
  const pending = JSON.parse(localStorage.getItem('acfms_pending_reports') || '[]');
  if (!pending.length) return;
  const synced = [];
  for (const report of pending) {
    try {
      await db.collection('reports').add({
        product: report.product,
        description: report.description,
        lat: report.lat, lng: report.lng,
        photoBase64: report.photoBase64 || null,
        aiResult: report.aiResult || null,
        timestamp: firebase.firestore.Timestamp.fromDate(new Date(report.createdAt)),
        userId: report.userId,
        status: 'pending',
      });
      synced.push(report.pendingId);
    } catch (err) { console.error('Sync failed for', report.pendingId, err); break; }
  }
  const remaining = pending.filter(r => !synced.includes(r.pendingId));
  localStorage.setItem('acfms_pending_reports', JSON.stringify(remaining));
  if (synced.length) showToast(`${synced.length} report(s) synced.`);
}

// ---------- GEOLOCATION ----------
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('Geolocation not supported'));
    else navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true }
    );
  });
}

// ---------- UI HELPERS ----------
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 500); }, 3000);
}

function formatTimestamp(ts) {
  if (!ts) return 'N/A';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

// ---------- FILE HELPERS ----------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- EXPORTS ----------
function exportToCSV(data, filename = 'aca-fis_reports.csv') {
  if (!data.length) return;
  const csv = [Object.keys(data[0]).join(','), ...data.map(row => Object.values(row).map(v => `"${v}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

function exportToPDF(data, filename = 'aca-fis_reports.pdf') {
  if (!data.length) return;
  if (typeof window.jspdf === 'undefined') { showToast('PDF library not loaded.', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text('ACA-FIS Reports', 14, 15);
  doc.autoTable({
    head: [Object.keys(data[0])],
    body: data.map(row => Object.values(row)),
    startY: 20, styles: { fontSize: 8 }, headStyles: { fillColor: [26, 86, 50] },
  });
  doc.save(filename);
}

// ---------- NOTIFICATIONS ----------
function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
}
function showBrowserNotification(title, options) {
  if (Notification.permission === 'granted') new Notification(title, options);
}
function listenForNewReports() {
  let lastTimestamp = new Date(0);
  db.collection('reports').orderBy('timestamp', 'desc').limit(1).onSnapshot(snap => {
    snap.forEach(doc => {
      const data = doc.data();
      const ts = data.timestamp?.toDate();
      if (ts && ts > lastTimestamp) {
        lastTimestamp = ts;
        if (auth.currentUser) showBrowserNotification('New Report Submitted', { body: `Product: ${data.product}` });
      }
    });
  });
}

// ---------- AI SCANNING (unchanged) ----------
async function analyzeImageWithVisionAPI(imageBase64) {
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`;
    const base64Data = imageBase64.includes('base64,') ? imageBase64.split('base64,')[1] : imageBase64;
    const requestBody = { requests: [{ image: { content: base64Data }, features: [ { type: "LOGO_DETECTION", maxResults: 10 }, { type: "LABEL_DETECTION", maxResults: 15 }, { type: "WEB_DETECTION", maxResults: 10 }, { type: "IMAGE_PROPERTIES", maxResults: 5 } ] }] };
    try {
        const response = await fetch(url, { method: 'POST', body: JSON.stringify(requestBody), headers: { 'Content-Type': 'application/json' } });
        const result = await response.json();
        const quickReport = processVisionResults(result);
        await new Promise(resolve => setTimeout(resolve, 15000));
        const deepReport = await performDeepAnalysis(quickReport, result);
        return deepReport;
    } catch (error) { console.error('Vision API error:', error); return null; }
}

function processVisionResults(apiResponse) {
    const annotations = apiResponse?.responses?.[0];
    if (!annotations) return { logos: [], labels: [], webEntities: [], potentialConcern: false, details: {} };
    const logos = (annotations.logoAnnotations || []).map(l => ({ description: l.description, confidence: (l.score * 100).toFixed(1) + '%' }));
    const labels = (annotations.labelAnnotations || []).map(l => l.description);
    const webEntities = (annotations.webDetection?.webEntities || []).map(e => e.description).filter(Boolean);
    const similarImages = (annotations.webDetection?.visuallySimilarImages || []).length || 0;
    const knownBrands = ['nike', 'adidas', 'puma', 'gucci', 'louis vuitton', 'apple', 'samsung', 'absolut', 'johnnie walker', 'jack daniel', 'smirnoff', 'hennessy'];
    const detectedBrand = logos.find(logo => knownBrands.some(brand => logo.description.toLowerCase().includes(brand)));
    const lowConfidenceLabels = labels.length > 0 && labels.every(l => ['shoe', 'clothing', 'bag', 'phone', 'watch', 'alcohol', 'bottle', 'drink'].some(w => l.toLowerCase().includes(w)));
    const potentialConcern = !!detectedBrand && lowConfidenceLabels;
    return { logos: logos.map(l => l.description), labels, webEntities, potentialConcern, details: { similarImagesCount: similarImages, logoConfidence: logos.length ? logos[0].confidence : '0%', labelCount: labels.length } };
}

async function performDeepAnalysis(quickReport, apiResponse) {
    const { logos, webEntities, details } = quickReport;
    const similarImages = details.similarImagesCount || 0;
    let deepConcern = quickReport.potentialConcern;
    let analysisNotes = '';
    if (similarImages > 5) {
        analysisNotes += `Found ${similarImages} visually similar images on the web. `;
        if (logos.length > 0 && webEntities.length === 0) { deepConcern = true; analysisNotes += 'No web entities linked to the detected logo – suspicious. '; }
        else if (logos.length > 0 && webEntities.length > 0) analysisNotes += 'Web matches align with detected brand. ';
    } else if (logos.length > 0 && similarImages <= 2) { deepConcern = true; analysisNotes += 'Few similar images found for a branded product – possible counterfeit. '; }
    else if (logos.length === 0) analysisNotes += 'No recognised logos detected. ';
    if (deepConcern && !quickReport.potentialConcern) analysisNotes += 'Deep analysis raises suspicion.';
    else if (!deepConcern) analysisNotes += 'Deep analysis did not find strong counterfeit indicators.';
    return { ...quickReport, potentialConcern: deepConcern, deepAnalysisNotes: analysisNotes, analysisDuration: '~20 seconds' };
}

// ---------- SERVICE WORKER & ONLINE SYNC ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').then(reg => console.log('SW registered')).catch(err => console.error('SW failed:', err));
  });
}
window.addEventListener('online', () => { syncPendingReports(); showToast('Back online. Syncing...', 'info'); });