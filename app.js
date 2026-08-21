/* ═══════════════════════════════════════════════════════════
   DAWAI SAHI HAI — app.js
   Part A: Detection engine (unchanged logic — database match,
            scan-volume anomaly, community reports)
   Part B: Premium interaction layer (tilt, reveal, counters,
            nav, FAQ) — new for the v2 redesign
═══════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────
// CONFIG — paste your Google Sheet CSV URL here.
// If you already had a URL from before, paste it back in.
// ─────────────────────────────────────────────────
const DB_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRmciAqFyv0gM1Ib9_EayToxIp9I3lmvGaHsENF_G0VcSdtEKRUDOaoMIlSN4fbBz6jRjp0LjYoqVkq/pub?gid=0&single=true&output=csv";

// Backend configuration.
// 1) Deploy Code.gs as a Google Apps Script Web App.
// 2) Put the resulting /exec URL in REPORT_API_URL.
// 3) Create a Reports tab in the SAME Google Sheet and publish that tab as CSV.
// 4) Put that published CSV URL in REPORTS_CSV_URL.
const REPORT_API_URL  = "https://script.google.com/macros/s/AKfycbwiOD0bQDyab6ljm9kUJ010LcanGkPlWB3GIKWjugV7r9v3bqZxlMusCDNdd5gH-zrayQ/exec";
const REPORTS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRmciAqFyv0gM1Ib9_EayToxIp9I3lmvGaHsENF_G0VcSdtEKRUDOaoMIlSN4fbBz6jRjp0LjYoqVkq/pub?gid=2023807364&single=true&output=csv";
const REPORT_REFRESH_MS = 15000;
let lastReportRefresh = 0;
let pendingReports = [];

// Icon strings (Feather/Lucide-style line icons, matches CSS .icon sizing)
const ICONS = {
  check:   '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  warn:    '<svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  danger:  '<svg viewBox="0 0 24 24"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  help:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 2-3 4"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

const COLORS = { green: "#0a8754", red: "#d92d20", amber: "#b45309", slate: "#86868b" };

// ═══════════════════════════════════════════════════
// PART A — DETECTION ENGINE
// ═══════════════════════════════════════════════════

let medicineDB    = [];
let scanLog       = {};
let reportLog     = [];
let reportContext = {
  barcode: "",
  medicine: ""
};



let scannerActive = false;
let appStats      = { totalScans: 0, flaggedBatches: 0, reportsSubmitted: 0 };

const DEMO_DB = [
  { barcode:"8901234567890", medicine_name:"Crocin 500mg",       manufacturer:"GSK Consumer Healthcare",   batch_prefix:"B25",   max_scans:"15000", status:"VERIFIED" },
  { barcode:"8902345678901", medicine_name:"Dolo 650",           manufacturer:"Micro Labs Ltd",            batch_prefix:"ML24",  max_scans:"20000", status:"VERIFIED" },
  { barcode:"8903456789012", medicine_name:"Azithral 500",       manufacturer:"Alembic Pharmaceuticals",   batch_prefix:"AZ25",  max_scans:"8000",  status:"VERIFIED" },
  { barcode:"8904567890123", medicine_name:"Pantop 40",          manufacturer:"Aristo Pharmaceuticals",    batch_prefix:"AR24",  max_scans:"12000", status:"VERIFIED" },
  { barcode:"8905678901234", medicine_name:"Allegra 120",        manufacturer:"Sanofi India",              batch_prefix:"SN25",  max_scans:"10000", status:"VERIFIED" },
  { barcode:"8906789012345", medicine_name:"Augmentin 625",      manufacturer:"GSK Pharmaceuticals",       batch_prefix:"AG24",  max_scans:"5000",  status:"VERIFIED" },
  { barcode:"8907890123456", medicine_name:"Metformin 500",      manufacturer:"Sun Pharma",                batch_prefix:"SP24",  max_scans:"25000", status:"VERIFIED" },
  { barcode:"8908901234567", medicine_name:"Atorvastatin 10mg",  manufacturer:"Cipla Ltd",                 batch_prefix:"CIP25", max_scans:"18000", status:"VERIFIED" },
  { barcode:"0000000000000", medicine_name:"[Flagged — Test Counterfeit]", manufacturer:"Unknown",         batch_prefix:"XX",    max_scans:"100",   status:"FLAGGED"  },
  { barcode:"9999999999999", medicine_name:"Levipil 500 [Anomaly Demo]",   manufacturer:"Sun Pharma",      batch_prefix:"LV24",  max_scans:"500",   status:"VERIFIED" },
];

const DEMO_SCAN_LOG = { "9999999999999": 12400, "8901234567890": 342, "8902345678901": 89 };

const DEMO_ALERTS = [
  { medicine:"Janumet 50/500",      batch:"JN2412", location:"Rajouri Garden, Delhi", issue:"Tablet colour lighter than usual, different smell", time:"2 hours ago" },
  { medicine:"Betnovate-C Ointment",batch:"BC2501", location:"Lal Bazar, Kolkata",     issue:"Packaging seal already broken, print quality poor", time:"5 hours ago" },
  { medicine:"Azithral 500",        batch:"AZ2409", location:"Camp Road, Pune",        issue:"Strip colour faded, tablet crumbles easily",         time:"Yesterday" },
];

async function loadDatabase() {
  if (DB_URL === "PASTE_YOUR_GOOGLE_SHEET_CSV_URL_HERE" || !DB_URL) {
    medicineDB = DEMO_DB;
    console.log("✅ Demo database loaded:", medicineDB.length, "medicines");
    return;
  }
  try {
    const res    = await fetch(DB_URL);
    const csv    = await res.text();
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    medicineDB   = parsed.data;
    console.log("✅ Live database loaded:", medicineDB.length, "medicines");
  } catch (err) {
    console.warn("⚠️ Could not load Google Sheet. Using demo data.");
    medicineDB = DEMO_DB;
  }
}

function loadScanLog() {
  try {
    const stored = localStorage.getItem("dawai_scan_log");
    scanLog = stored ? JSON.parse(stored) : { ...DEMO_SCAN_LOG };
  } catch { scanLog = { ...DEMO_SCAN_LOG }; }

  try {
    const stats = localStorage.getItem("dawai_stats");
    appStats = stats ? JSON.parse(stats) : { totalScans: 1247, flaggedBatches: 3, reportsSubmitted: 89 };
  } catch { appStats = { totalScans: 1247, flaggedBatches: 3, reportsSubmitted: 89 }; }
}

function saveScanLog() {
  try {
    localStorage.setItem("dawai_scan_log", JSON.stringify(scanLog));
    localStorage.setItem("dawai_stats", JSON.stringify(appStats));
  } catch {}
}

function loadPendingReports() {
  try {
    const stored = localStorage.getItem("dawai_pending_reports");
    pendingReports = stored ? JSON.parse(stored) : [];
  } catch {
    pendingReports = [];
  }
}

function savePendingReports() {
  try {
    localStorage.setItem("dawai_pending_reports", JSON.stringify(pendingReports));
  } catch {}
}

function reportKey(report) {
  return [
    report.timestamp || report.time || "",
    report.barcode || "",
    report.batch || "",
    report.medicine || ""
  ].join("|");
}

// Read persistent community reports from the published Reports sheet.
// This is separate from the write endpoint because a published CSV is easy
// for a GitHub Pages frontend to read cross-origin.
async function loadReports(force = false) {
  const now = Date.now();
  if (!force && now - lastReportRefresh < REPORT_REFRESH_MS) return;
  if (!REPORTS_CSV_URL || REPORTS_CSV_URL.includes("PASTE_PUBLISHED_REPORTS_CSV_URL_HERE")) {
    return;
  }

  try {
    const res = await fetch(REPORTS_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Reports CSV HTTP ${res.status}`);
    const csv = await res.text();
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    const backendReports = parsed.data.map(r => ({
      timestamp: r.timestamp || r.time || "",
      time: r.timestamp || r.time || "",
      barcode: (r.barcode || "").trim(),
      medicine: r.medicine || r.medicine_name || "",
      batch: (r.batch || "").trim(),
      location: r.location || "",
      issue: r.issue || "",
      status: r.status || "OPEN"
    })).filter(r => r.medicine || r.batch || r.barcode);

    const backendKeys = new Set(backendReports.map(reportKey));
    pendingReports = pendingReports.filter(r => !backendKeys.has(reportKey(r)));
    savePendingReports();

    const merged = new Map();
    [...backendReports, ...pendingReports].forEach(report => {
      merged.set(reportKey(report), report);
    });
    reportLog = Array.from(merged.values());

    appStats.reportsSubmitted = backendReports.length;
    lastReportRefresh = now;
    saveScanLog();
    renderAlerts();
    updateCounters();
    console.log("✅ Persistent reports loaded:", reportLog.length);
  } catch (err) {
    console.warn("⚠️ Could not load Reports CSV. Keeping local/demo reports.", err);
  }
}

function normalizeReportBatch(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function reportMatchesMedicine(report, barcode, match) {
  const reportBarcode = String(report.barcode || "").trim();
  const reportBatch = normalizeReportBatch(report.batch);
  const medicineBatch = normalizeReportBatch(match?.batch_prefix || "");

  if (reportBarcode && reportBarcode === String(barcode).trim()) return true;
  if (medicineBatch && reportBatch && reportBatch.startsWith(medicineBatch)) return true;
  return false;
}

// Send a persistent report to Google Apps Script.
// We deliberately use a simple URL-encoded POST + no-cors so GitHub Pages
// can write to Apps Script without triggering a browser preflight request.
async function persistReportToBackend(report) {
  if (!REPORT_API_URL || REPORT_API_URL.includes("PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE")) {
    throw new Error("REPORT_API_URL is not configured");
  }

  const body = new URLSearchParams({
    action: "report",
    timestamp: report.timestamp || new Date().toISOString(),
    barcode: report.barcode || "",
    medicine: report.medicine || "",
    batch: report.batch || "",
    location: report.location || "",
    issue: report.issue || "",
    status: report.status || "OPEN"
  });

  const response = await fetch(REPORT_API_URL, {
    method: "POST",
    mode: "no-cors",
    body
  });

  // no-cors gives an opaque response, so reaching here means the browser
  // completed the network request. The Apps Script backend is responsible
  // for the actual sheet write.
  return response;
}

function incrementScanCount(barcode) {
  scanLog[barcode]    = (scanLog[barcode] || 0) + 1;
  appStats.totalScans = (appStats.totalScans || 0) + 1;
  saveScanLog();
}
function getScanCount(barcode) { return scanLog[barcode] || 0; }

// ═══════════════════════════════════════════════════
// DETECTION ENGINE — chooses the best available option
//
// 1. Native BarcodeDetector (Chrome/Edge): taps directly into the
//    OS vision engine (CoreImage on macOS, ML Kit on Android). This
//    is the actual same-class engine Google/Apple use natively —
//    not a JS approximation.
// 2. ZXing fallback (Safari/Firefox, where BarcodeDetector doesn't
//    exist): ZXing is the barcode engine Google itself originally
//    open-sourced for Android, ported to JS.
//
// Both paths feed into the SAME confirmation + checksum gate below,
// which is what actually fixes "reads correct sometimes, wrong
// other times" — a single blurry frame can no longer get accepted.
// ═══════════════════════════════════════════════════

let engineMode      = null;   // 'native' | 'zxing'
let nativeDetector  = null;
let zxingReader     = null;
let zxingControls   = null;
let rafId           = null;
let videoEl         = null;
let mediaStream     = null;

const WANTED_FORMATS = ["ean_13","ean_8","upc_a","upc_e","code_128","code_39"];

async function pickDetectionEngine() {
  if ("BarcodeDetector" in window) {
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      const usable = WANTED_FORMATS.filter(f => supported.includes(f));
      if (usable.length > 0) {
        nativeDetector = new BarcodeDetector({ formats: usable });
        engineMode = "native";
        setEngineBadge("Using your browser's native scanner (OS-level detection)");
        return;
      }
    } catch (e) {
      console.warn("Native BarcodeDetector probe failed, falling back to ZXing.", e);
    }
  }
  engineMode = "zxing";
  setEngineBadge("Using ZXing scanner (Google's open-source barcode engine)");
}

function setEngineBadge(text) {
  const el = document.getElementById("engineBadge");
  if (el) el.innerHTML = '<span class="dot">●</span> ' + text;
}

// ── Multi-frame confirmation buffer ──
// A single frame's read is never trusted on its own. The SAME value
// must be read this many times in a row before it's accepted.
const CONFIRM_NEEDED = 3;
let confirmBuffer = [];

function resetConfirmBuffer() {
  confirmBuffer = [];
  updateConfirmMeter(0);
}

function updateConfirmMeter(n) {
  const meter = document.getElementById("confirmMeter");
  if (!meter) return;
  meter.classList.toggle("active", n > 0);
  for (let i = 1; i <= CONFIRM_NEEDED; i++) {
    const dot = document.getElementById("confirmDot" + i);
    if (dot) dot.classList.toggle("filled", i <= n);
  }
}

// ── Checksum validation (GS1 standard, verified independently —
// see build notes) — mathematically rejects impossible barcodes
// before they ever reach the confirmation buffer. This alone kills
// most "misread one digit" errors, since a single wrong digit
// almost always fails the check digit. ──
function isValidChecksum(code) {
  if (!/^\d+$/.test(code)) return true;          // non-numeric (Code128/39) — skip, can't check
  if (![8, 12, 13].includes(code.length)) return true; // only known retail lengths
  const digits  = code.split("").map(Number);
  const check   = digits[digits.length - 1];
  const payload = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const weight = (payload.length - i) % 2 === 1 ? 3 : 1;
    sum += payload[i] * weight;
  }
  const calculated = (10 - (sum % 10)) % 10;
  return calculated === check;
}

function handleRawDetection(rawValue) {
  if (!rawValue || !scannerActive) return;
  if (!isValidChecksum(rawValue)) return; // mathematically impossible — a misread, ignore silently

  if (confirmBuffer.length && confirmBuffer[confirmBuffer.length - 1] !== rawValue) {
    confirmBuffer = []; // a different code appeared — restart confirmation on the new one
  }
  confirmBuffer.push(rawValue);
  updateConfirmMeter(confirmBuffer.length);

  if (confirmBuffer.length >= CONFIRM_NEEDED) {
    playBeep();
    stopScanner();
    checkMedicine(rawValue);
  }
}

// ── Native engine loop ──
function nativeDetectLoop() {
  if (!scannerActive || !videoEl) return;
  nativeDetector.detect(videoEl)
    .then(barcodes => {
      if (barcodes.length > 0) handleRawDetection(barcodes[0].rawValue);
    })
    .catch(() => {}) // a frame that fails to decode is normal, not an error
    .finally(() => {
      if (scannerActive) rafId = requestAnimationFrame(nativeDetectLoop);
    });
}

// ── Start / stop ──
async function startScanner() {
  document.getElementById("scannerIdle").style.display = "none";
  document.getElementById("scanBeam").style.display    = "block";
  document.getElementById("startBtn").style.display    = "none";
  document.getElementById("stopBtn").style.display      = "flex";
  document.getElementById("resultSection").classList.add("hidden");
  resetConfirmBuffer();

  if (!engineMode) await pickDetectionEngine();

  const interactiveEl = document.getElementById("interactive");
  interactiveEl.innerHTML = "";
  videoEl = document.createElement("video");
  videoEl.setAttribute("playsinline", "");
  videoEl.setAttribute("muted", "");
  videoEl.muted = true;
  videoEl.style.width = "100%";
  videoEl.style.height = "100%";
  videoEl.style.objectFit = "cover";
  interactiveEl.appendChild(videoEl);

  if (engineMode === "native") {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      videoEl.srcObject = mediaStream;
      await videoEl.play();
      scannerActive = true;
      nativeDetectLoop();
    } catch (err) {
      alert("Camera not available.\n\nUse the manual barcode entry below instead.\n\n" + (err?.message || err));
      stopScanner();
    }

  } else {
    try {
      if (!zxingReader) {
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
          ZXing.BarcodeFormat.UPC_A,  ZXing.BarcodeFormat.UPC_E,
          ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39
        ]);
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        zxingReader = new ZXing.BrowserMultiFormatReader(hints);
      }
      scannerActive = true;

      // FIX: Use standard HTML5 media API instead of ZXing's broken static method
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
      
      const backCam = videoDevices.find(d => /back|rear|environment/i.test(d.label));
      const deviceId = backCam ? backCam.deviceId : (videoDevices.length > 0 ? videoDevices[0].deviceId : undefined);

      zxingControls = await zxingReader.decodeFromVideoDevice(deviceId, videoEl, (result) => {
        if (result) {
          const text = (result.getText && result.getText()) || result.text || "";
          if (text) handleRawDetection(text);
        }
        // NotFoundException on frames with no barcode is expected every
        // frame until one appears — not an error, nothing to do here.
      });
    } catch (err) {
      alert("Camera not available.\n\nUse the manual barcode entry below instead.\n\n" + (err?.message || err));
      stopScanner();
    }
  }
}

function stopScanner() {
  scannerActive = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (zxingControls) { try { zxingControls.stop(); } catch (e) {} zxingControls = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (videoEl) { videoEl.srcObject = null; }
  resetConfirmBuffer();

  document.getElementById("scannerIdle").style.display = "flex";
  document.getElementById("scanBeam").style.display    = "none";
  document.getElementById("startBtn").style.display    = "flex";
  document.getElementById("stopBtn").style.display      = "none";
}

function manualCheck() {
  const val = document.getElementById("manualInput").value.trim();
  if (!val) { document.getElementById("manualInput").focus(); return; }
  checkMedicine(val);
}

async function checkMedicine(barcode) {
  barcode = String(barcode || "").trim();
  window.lastScannedBarcode = barcode;
  if (!barcode) return;

  // Keep the UI responsive with a local count, then refresh persistent
  // community reports before determining the final verdict.
  incrementScanCount(barcode);
  await loadReports();
  const currentCount = getScanCount(barcode);

  const match = medicineDB.find(row => row.barcode && row.barcode.trim() === barcode);

  let volumeAnomaly = false, maxScans = 0;
  if (match && match.max_scans) {
    maxScans = parseInt(match.max_scans) || 0;
    volumeAnomaly = maxScans > 0 && currentCount > maxScans * 0.8;
  }

  const matchingReports = reportLog.filter(r => reportMatchesMedicine(r, barcode, match));
  const reportCount = matchingReports.length;
  const hasReports  = reportCount > 0;

  let verdict;
  if (!match)                          verdict = "UNKNOWN";
  else if (match.status === "FLAGGED") verdict = "SUSPICIOUS";
  else if (volumeAnomaly)               verdict = "ANOMALY";
  else if (hasReports)                  verdict = "REPORTED";
  else                                  verdict = "VERIFIED";

  renderResult(verdict, match, barcode, currentCount, maxScans, reportCount);
  updateCounters();
  saveScanLog();
}

function setIcon(elId, svg, color) {
  const el = document.getElementById(elId);
  el.innerHTML = svg;
  el.style.color = color;
}

function renderResult(verdict, match, barcode, scanCount, maxScans, reportCount) {
  const section = document.getElementById("resultSection");
  const card    = document.getElementById("resultCard");
  card.className = "result-card";

  document.getElementById("resultBarcode").textContent = "Barcode: " + barcode;
  document.getElementById("scanCountNum").textContent  = scanCount.toLocaleString("en-IN");
  document.getElementById("resultMedicineName").textContent = match ? (match.medicine_name + " — " + match.manufacturer) : "";

  if (verdict === "VERIFIED") {
    card.classList.add("verified");
    setIcon("resultIcon", ICONS.check, "");
    document.getElementById("resultVerdict").textContent = "Medicine Verified";
    document.getElementById("resultDetail").textContent =
      "All three verification signals are clear. This medicine matches our database and shows no anomalous scan patterns or community reports.";
    setSignals(
      { icon: ICONS.check, color: COLORS.green, text: "Database — Found in verified manufacturer records" },
      { icon: ICONS.check, color: COLORS.green, text: "Volume — Scan count within expected range (batch of " + maxScans.toLocaleString("en-IN") + ")" },
      { icon: ICONS.check, color: COLORS.green, text: "Community — No reports filed against this batch" }
    );

  } else if (verdict === "SUSPICIOUS") {
    card.classList.add("suspicious");
    appStats.flaggedBatches++;
    setIcon("resultIcon", ICONS.danger, "");
    document.getElementById("resultVerdict").textContent = "Do Not Consume";
    document.getElementById("resultDetail").textContent =
      "This batch is explicitly flagged as potentially counterfeit. Keep the strip as evidence and call CDSCO: 1800-11-4477.";
    setSignals(
      { icon: ICONS.danger, color: COLORS.red,   text: "Database — This batch is flagged as counterfeit" },
      { icon: ICONS.warn,   color: COLORS.amber, text: scanCount.toLocaleString("en-IN") + " scans logged for this barcode" },
      { icon: ICONS.warn,   color: COLORS.amber, text: "Community — Please file a report below" }
    );

  } else if (verdict === "ANOMALY") {
    card.classList.add("suspicious");
    appStats.flaggedBatches++;
    setIcon("resultIcon", ICONS.warn, "");
    document.getElementById("resultVerdict").textContent = "Scan Anomaly Detected";
    document.getElementById("resultDetail").textContent =
      "This medicine exists in our database, but scan volume for this batch far exceeds a genuine production run of " +
      maxScans.toLocaleString("en-IN") + " strips — a strong signal of duplication. Exercise caution.";
    setSignals(
      { icon: ICONS.check, color: COLORS.green, text: "Database — Found in verified manufacturer records" },
      { icon: ICONS.danger,color: COLORS.red,   text: scanCount.toLocaleString("en-IN") + " scans on a batch of only " + maxScans.toLocaleString("en-IN") + " — likely duplicated" },
      { icon: ICONS.warn,  color: COLORS.amber, text: reportCount > 0 ? reportCount + " report(s) filed" : "No reports yet — report below if suspicious" }
    );

  } else if (verdict === "REPORTED") {
    card.classList.add("suspicious");
    setIcon("resultIcon", ICONS.warn, "");
    document.getElementById("resultVerdict").textContent = "Community Reports Filed";
    document.getElementById("resultDetail").textContent =
      "Reported as suspicious by " + reportCount + " user(s). Database check passed, but proceed with caution.";
    setSignals(
      { icon: ICONS.check, color: COLORS.green, text: "Database — Found in verified records" },
      { icon: ICONS.check, color: COLORS.green, text: "Volume — Scan count within normal range" },
      { icon: ICONS.danger,color: COLORS.red,   text: reportCount + " report(s) filed against this batch" }
    );

  } else {
    card.classList.add("unknown");
    setIcon("resultIcon", ICONS.help, "");
    document.getElementById("resultVerdict").textContent = "Not in Database Yet";
    document.getElementById("resultDetail").textContent =
      "This barcode isn't in our current database of " + medicineDB.length + " medicines. Full CDSCO integration will cover every medicine in India. Buy only from registered pharmacies.";
    setSignals(
      { icon: ICONS.help, color: COLORS.slate, text: "Database — Not found (" + medicineDB.length + " medicines indexed)" },
      { icon: ICONS.help, color: COLORS.slate, text: scanCount.toLocaleString("en-IN") + " scans logged for this barcode" },
      { icon: ICONS.help, color: COLORS.slate, text: "Community — No reports. You can report below." }
    );
  }

  section.classList.remove("hidden");
  setTimeout(() => section.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
}

function setSignals(s1, s2, s3) {
  [["sig1IconBox","sig1Text",s1],["sig2IconBox","sig2Text",s2],["sig3IconBox","sig3Text",s3]].forEach(([iconId,textId,sig]) => {
    const box = document.getElementById(iconId);
    box.innerHTML = `<span class="icon">${sig.icon}</span>`;
    box.style.color = sig.color;
    document.getElementById(textId).textContent = sig.text;
  });
}

function resetScan() {
  document.getElementById("resultSection").classList.add("hidden");
  document.getElementById("resultCard").className = "result-card";
  document.getElementById("manualInput").value = "";
}

  function prepareReportForm(linkToCurrentScan = false) {
  const barcodeInput =
    document.getElementById("reportBarcode");

  const brandInput =
    document.getElementById("reportBrand");

  const linked =
    document.getElementById("reportLinkedScan");

  if (!barcodeInput) return;

  // Manual report: NEVER reuse an older scan.
  if (!linkToCurrentScan) {
    barcodeInput.value = "";

    if (brandInput) {
      brandInput.value = "";
    }

    if (linked) {
      linked.textContent =
        "No scan linked — you can still submit a report manually.";
    }

    return;
  }

  // Report started from the current scan.
  const activeBarcode =
    String(window.lastScannedBarcode || "").trim();

  if (!activeBarcode) {
    barcodeInput.value = "";

    if (linked) {
      linked.textContent =
        "No scan linked — you can still submit a report manually.";
    }

    return;
  }

  const match =
    medicineDB.find(
      row =>
        row.barcode &&
        row.barcode.trim() === activeBarcode
    );

  barcodeInput.value = activeBarcode;

  if (
    brandInput &&
    match &&
    !brandInput.value.trim()
  ) {
    brandInput.value =
      match.medicine_name || "";
  }

  if (linked) {
    linked.textContent =
      `Linked to scanned barcode ${activeBarcode}`;
  }
}


async function submitReport() {
  const brand    = document.getElementById("reportBrand").value.trim();
  const batch    = document.getElementById("reportBatch").value.trim();
  const location = document.getElementById("reportLocation").value.trim();
  const issue    = document.getElementById("reportIssue").value.trim();
  const barcode =
  document.getElementById("reportBarcode")?.value.trim() || "";

  if (!brand || !batch || !location) {
    alert("Please fill in Medicine Name, Batch Number, and Location before submitting.");
    return;
  }

  const submitButton = document.querySelector(".btn-report-full");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";
  }

  const report = {
    timestamp: new Date().toISOString(),
    time: new Date().toISOString(),
    barcode,
    medicine: brand,
    batch,
    location,
    issue: issue || "Suspicious appearance",
    status: "OPEN"
  };

  try {
    // Optimistic local insert: current-page scans react immediately.
    reportLog.push(report);
    pendingReports.push(report);
    savePendingReports();
    appStats.reportsSubmitted = Math.max(appStats.reportsSubmitted || 0, reportLog.length);
    saveScanLog();
    addAlertToUI({ ...report, time: "Just now" });
    updateCounters();

    await persistReportToBackend(report);

    const success = document.getElementById("reportSuccess");
    success.textContent = "Report submitted and sent to the backend. It will be used in subsequent verification checks.";
    success.classList.remove("hidden");

    ["reportBrand","reportBatch","reportLocation","reportIssue","reportBarcode"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    window.lastScannedBarcode = "";
    const linked = document.getElementById("reportLinkedScan");
    if (linked) linked.textContent = "Report saved.";

    // Give the published Reports CSV time to update, then refresh the
    // application's persistent view. The local insert remains the fallback.
    setTimeout(() => loadReports(true), 2500);
    setTimeout(() => success.classList.add("hidden"), 6000);
  } catch (err) {
    console.error("[Dawai Sahi Hai] report submission failed:", err);

    // Roll back the optimistic insert if the backend request could not be made.
    reportLog = reportLog.filter(r => r !== report);
    pendingReports = pendingReports.filter(r => r !== report);
    savePendingReports();
    appStats.reportsSubmitted = Math.max(0, reportLog.length);
    saveScanLog();
    alert("The report could not be sent to the backend. Check the Apps Script URL configuration and try again.");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Submit Report";
    }
  }
}

function reportCurrentScan() {
  // This path is used only when the user clicks
  // "Report This" from the current scan result.
  prepareReportForm(true);

  document.getElementById("report").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function scrollToReport() { 
  // Manual report: clear any previous scan context.
  prepareReportForm(false);

  document.getElementById("report").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function renderAlerts() {
  const list = document.getElementById("alertsList");
  if (!list) return;

  list.innerHTML = "";

  const MAX_VISIBLE_ALERTS = 5;

  // Keep only the newest reports for the homepage.
  const recentReports = reportLog
    .slice()
    .sort((a, b) => {
      const timeA = new Date(a.timestamp || a.time || 0).getTime();
      const timeB = new Date(b.timestamp || b.time || 0).getTime();
      return timeB - timeA;
    })
    .slice(0, MAX_VISIBLE_ALERTS);

  // Show real reports when available.
  if (recentReports.length > 0) {
    recentReports.forEach(report => {
      addAlertToUI({
        medicine: report.medicine || "Unknown medicine",
        batch: report.batch || "Unknown batch",
        barcode: report.barcode || "",
        location: report.location || "Location not provided",
        issue: report.issue || "Suspicious appearance",
        time: report.timestamp || report.time || ""
      });
    });

    return;
  }

  // Demo alerts only when there are no real reports yet.
  DEMO_ALERTS
    .slice(0, MAX_VISIBLE_ALERTS)
    .forEach(alert => addAlertToUI(alert));
}

function addAlertToUI(alert) {
  const list = document.getElementById("alertsList");
  if (!list) return;
  const item = document.createElement("div");
  item.className = "alert-item";
  item.innerHTML = `
    <div class="alert-top"><span class="icon">${ICONS.danger}</span><span class="alert-medicine">${escapeHTML(alert.medicine || "Unknown medicine")} — Batch ${escapeHTML(alert.batch || "N/A")}</span></div>
    <div class="alert-meta">${escapeHTML(alert.location || "Location not provided")}</div>
    <div class="alert-meta">${escapeHTML(alert.issue || "Suspicious appearance")}</div>
    <div class="alert-time">${escapeHTML(alert.time || "")}</div>
  `;
  list.insertBefore(item, list.firstChild);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>\"]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[c]));
}

function updateCounters() {
  const el = (id) => document.getElementById(id);
  if (!el("totalScans")) return;
  el("totalScans").textContent        = (appStats.totalScans || 0).toLocaleString("en-IN");
  el("flaggedBatches").textContent    = (appStats.flaggedBatches || 0).toLocaleString("en-IN");
  el("reportsSubmitted").textContent  = (reportLog.length || appStats.reportsSubmitted || 0).toLocaleString("en-IN");
  el("medicinesVerified").textContent = medicineDB.length.toLocaleString("en-IN");
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 1046; osc.type = "sine";
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════
// PART B — PREMIUM INTERACTION LAYER
// ═══════════════════════════════════════════════════

// Navigation helpers (called from onclick attributes)
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}
function scrollToScan() { scrollToId("scan"); }

// Sticky nav shrink + mobile menu
function initNav() {
  const navbar = document.getElementById("navbar");
  window.addEventListener("scroll", () => {
    navbar.classList.toggle("scrolled", window.scrollY > 12);
  });

  const burger = document.getElementById("navBurger");
  const mobile = document.getElementById("navMobile");
  burger.addEventListener("click", () => mobile.classList.toggle("open"));
  mobile.querySelectorAll("a").forEach(a => a.addEventListener("click", () => mobile.classList.remove("open")));
}

// Scroll-reveal (single quiet motion pattern, used broadly but restrained)
function initReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    els.forEach(el => el.classList.add("in-view"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  els.forEach(el => io.observe(el));
}

// Hero device tilt — the one signature 3D moment (hover-capable devices only)
function initTilt() {
  if (!window.matchMedia("(hover: hover)").matches) return;
  const wrap  = document.querySelector(".device-wrap");
  const frame = document.getElementById("deviceFrame");
  if (!wrap || !frame) return;

  wrap.addEventListener("mousemove", (e) => {
    const rect = wrap.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    frame.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 14}deg)`;
  });
  wrap.addEventListener("mouseleave", () => {
    frame.style.transform = "rotateY(0deg) rotateX(0deg)";
  });
}

// Animated count-up for impact numbers (runs once, on first scroll into view)
function animateCount(el, target, duration = 1400) {
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased).toLocaleString("en-IN");
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function initCounters() {
  const section = document.getElementById("impact");
  if (!section || !("IntersectionObserver" in window)) return;
  let done = false;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !done) {
        done = true;
        animateCount(document.getElementById("totalScans"),       appStats.totalScans || 1247);
        animateCount(document.getElementById("flaggedBatches"),   appStats.flaggedBatches || 3);
        animateCount(document.getElementById("reportsSubmitted"), appStats.reportsSubmitted || 89);
        animateCount(document.getElementById("medicinesVerified"),medicineDB.length || 8);
        io.disconnect();
      }
    });
  }, { threshold: 0.3 });
  io.observe(section);
}

// FAQ accordion
function initFAQ() {
  document.querySelectorAll(".faq-item").forEach(item => {
    item.querySelector(".faq-q").addEventListener("click", () => {
      const isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach(i => i.classList.remove("open"));
      if (!isOpen) item.classList.add("open");
    });
  });
}

// Enter key on manual barcode input
function initManualInputEnterKey() {
  const input = document.getElementById("manualInput");
  if (input) input.addEventListener("keydown", e => { if (e.key === "Enter") manualCheck(); });
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
// Runs each step independently — if one fails, the rest still run.
// Critical for a live demo: a single missing element or blocked CDN
// script should never take down the whole page.
function safeRun(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.error("[Dawai Sahi Hai] " + label + " failed:", err);
  }
}

async function init() {
  await safeRun("loadDatabase", loadDatabase);
  await safeRun("pickDetectionEngine", pickDetectionEngine);
  safeRun("loadScanLog", loadScanLog);
  safeRun("loadPendingReports", loadPendingReports);
  await safeRun("loadReports", loadReports);
  safeRun("renderAlerts", renderAlerts);
  safeRun("updateCounters", updateCounters);

  safeRun("initNav", initNav);
  safeRun("initReveal", initReveal);
  safeRun("initTilt", initTilt);
  safeRun("initCounters", initCounters);
  safeRun("initFAQ", initFAQ);
  safeRun("initManualInputEnterKey", initManualInputEnterKey);

  console.log("✅ Dawai Sahi Hai initialized");
}

document.addEventListener("DOMContentLoaded", init);
