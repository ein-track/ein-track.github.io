// 1. Tempelkan URL /exec Google Apps Script Anda di sini
const API_URL = "https://script.google.com/macros/s/AKfycbyWHgkbFWxGLm9tnVrpCJPHGgoJt8AGlPuQ1iDWLsmaZ0o-Pu6X6FGnqL5JAmTmZw/exec";

// 2. Tempelkan Google OAuth 2.0 Web Client ID Anda di sini
const GOOGLE_CLIENT_ID = "503622156900-croba059bg083vs923bokhi2o04dvt2q.apps.googleusercontent.com";

const AUTH_SESSION_KEY = "gas_tracker_google_session_v6";

let allCylinders = [];
let pendingAuthAction = null;
let toastTimer = null;

function getApiUrl() {
  return API_URL.trim();
}

function getGoogleClientId() {
  return GOOGLE_CLIENT_ID.trim();
}

function isWarehouseLocation(loc) {
  const v = String(loc || "").trim().toLowerCase();
  return v === "di gudang" || v === "in warehouse";
}

function getAuthSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.id_token || !parsed.email) return null;
    if (parsed.exp && Date.now() >= Number(parsed.exp) * 1000) {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isAuthorized() {
  return Boolean(getAuthSession());
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) throw new Error("Token kredensial Google tidak valid.");
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3400);
}

function updateStatusBadges(syncOk = true) {
  const syncPill = document.getElementById("syncPill");
  if (!getApiUrl()) {
    syncPill.textContent = "URL API Belum Diatur";
    syncPill.className = "pill sync-error";
  } else if (syncOk) {
    syncPill.textContent = "Tersinkronisasi Google Sheet";
    syncPill.className = "pill sync-cloud";
  } else {
    syncPill.textContent = "Gagal Sinkronisasi Sheet";
    syncPill.className = "pill sync-error";
  }

  const session = getAuthSession();
  const authPill = document.getElementById("authPill");
  const authToggleBtn = document.getElementById("authToggleBtn");
  const readonlyBanner = document.getElementById("readonlyBanner");

  if (session) {
    authPill.textContent = `Masuk: ${session.email}`;
    authPill.className = "pill auth-unlocked";
    authToggleBtn.textContent = "Keluar";
    authToggleBtn.className = "btn btn-dark-outline";
    readonlyBanner.classList.add("hidden");
  } else {
    authPill.textContent = "Mode Lihat Saja";
    authPill.className = "pill auth-locked";
    authToggleBtn.textContent = "Masuk dengan Google";
    authToggleBtn.className = "btn btn-success";
    readonlyBanner.classList.remove("hidden");
  }
}

/* Sembunyikan & kosongkan kolom Pelanggan/Stasiun saat lokasi Di Gudang */
function syncClientStationFieldVisibility() {
  const loc = document.getElementById("location").value;
  const locationGroup = document.getElementById("locationGroup");
  const clientGroup = document.getElementById("clientStationGroup");
  const clientLabel = document.getElementById("clientStationLabel");
  const clientInput = document.getElementById("client_or_station");

  if (isWarehouseLocation(loc)) {
    clientInput.value = "";
    clientGroup.style.display = "none";
    locationGroup.classList.add("full");
  } else {
    clientGroup.style.display = "flex";
    locationGroup.classList.remove("full");
    if (loc === "Di Pelanggan") {
      clientLabel.textContent = "Nama Pelanggan";
      clientInput.placeholder = "cth. PT Mitra Baja";
    } else if (loc === "Di Stasiun Pengisian") {
      clientLabel.textContent = "Nama Stasiun Pengisian";
      clientInput.placeholder = "cth. Stasiun Pengisian Utama";
    } else {
      clientLabel.textContent = "Nama Pelanggan / Stasiun Pengisian / Rak";
      clientInput.placeholder = "cth. PT Mitra Baja / Stasiun Pengisian Utama";
    }
  }
}

/* Modal Google Identity Services Sign-In */
function renderGoogleSignInButton() {
  const container = document.getElementById("googleBtnContainer");
  const warningEl = document.getElementById("clientIdMissingNote");
  const errEl = document.getElementById("authError");
  const clientId = getGoogleClientId();

  container.innerHTML = "";
  if (!clientId) {
    warningEl.style.display = "block";
    return;
  }
  warningEl.style.display = "none";

  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    errEl.textContent = "Pustaka Google Sign-In sedang dimuat atau terblokir. Tunggu 2 detik dan coba lagi.";
    errEl.style.display = "block";
    return;
  }

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: handleGoogleCredentialResponse
  });

  window.google.accounts.id.renderButton(container, {
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "rectangular",
    locale: "id",
    width: 280
  });
}

async function handleGoogleCredentialResponse(response) {
  const errEl = document.getElementById("authError");
  errEl.style.display = "none";
  errEl.textContent = "";

  try {
    const idToken = response && response.credential;
    if (!idToken) throw new Error("Tidak ada kredensial yang dikembalikan dari Google.");

    const apiUrl = getApiUrl();
    if (!apiUrl) {
      errEl.textContent = "API_URL belum diatur di dalam res/app.js.";
      errEl.style.display = "block";
      return;
    }

    const claims = decodeJwtPayload(idToken);
    const email = String(claims.email || "").trim().toLowerCase();

    showToast("Memverifikasi izin akun Google...");
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "verify_token", id_token: idToken })
    });
    const data = await res.json();
    if (!data.ok) {
      errEl.textContent = data.error || "Akun Google Anda tidak memiliki izin untuk mengedit.";
      errEl.style.display = "block";
      return;
    }

    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      id_token: idToken,
      email: email,
      name: claims.name || email,
      exp: claims.exp || 0
    }));

    document.getElementById("authModal").classList.remove("open");
    updateStatusBadges(true);
    showToast(`Berhasil masuk sebagai ${email}`);

    if (pendingAuthAction) {
      const fn = pendingAuthAction;
      pendingAuthAction = null;
      fn();
    }
  } catch (err) {
    errEl.textContent = "Verifikasi masuk gagal: " + err.message;
    errEl.style.display = "block";
  }
}

function openAuthPopup(callback) {
  pendingAuthAction = typeof callback === "function" ? callback : null;
  const errEl = document.getElementById("authError");
  errEl.style.display = "none";
  errEl.textContent = "";
  document.getElementById("authModal").classList.add("open");
  renderGoogleSignInButton();
}

function requireAuth(callback) {
  if (isAuthorized()) {
    callback();
  } else {
    openAuthPopup(callback);
  }
}

function signOutSession() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  document.getElementById("formModal").classList.remove("open");
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
  }
  updateStatusBadges(true);
  showToast("Keluar: Beralih kembali ke Mode Lihat Saja.");
}

/* Helper API Google Apps Script */
async function postToSheet(payload) {
  const apiUrl = getApiUrl();
  if (!apiUrl) throw new Error("API_URL belum dikonfigurasi di res/app.js.");
  const session = getAuthSession();
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      ...payload,
      id_token: session ? session.id_token : ""
    })
  });
  return await res.json();
}

async function refreshData() {
  const apiUrl = getApiUrl();
  const refreshBtn = document.getElementById("refreshBtn");

  if (!apiUrl) {
    updateStatusBadges(false);
    renderView();
    showToast("Atur API_URL di dalam res/app.js untuk memuat data Google Sheet.");
    return;
  }

  refreshBtn.disabled = true;
  refreshBtn.textContent = "Menyinkronkan...";
  try {
    const res = await fetch(apiUrl);
    const data = await res.json();
    if (Array.isArray(data)) {
      allCylinders = data;
      updateStatusBadges(true);
      renderView();
    } else if (data && data.error) {
      updateStatusBadges(false);
      showToast("Kesalahan API Sheet: " + data.error);
    }
  } catch (err) {
    updateStatusBadges(false);
    showToast("Gagal menghubungi API Google Sheet: " + err.message);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Segarkan";
  }
}

function renderView() {
  document.getElementById("statTotal").textContent = allCylinders.length;
  document.getElementById("statWarehouse").textContent = allCylinders.filter(
    c => isWarehouseLocation(c.location)
  ).length;
  document.getElementById("statClients").textContent = allCylinders.filter(
    c => c.location === "Di Pelanggan" || c.location === "In Clients"
  ).length;
  document.getElementById("statRefill").textContent = allCylinders.filter(
    c => c.location === "Di Stasiun Pengisian" || c.location === "In Refill Station"
  ).length;

  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const loc = document.getElementById("locationFilter").value;
  const gas = document.getElementById("gasFilter").value;
  const st = document.getElementById("statusFilter").value;

  const filtered = allCylinders
    .filter(item => {
      if (loc && item.location !== loc) return false;
      if (gas && item.gas_type !== gas) return false;
      if (st && item.status !== st) return false;
      if (q) {
        const hay = [
          item.cylinder_number,
          item.gas_type,
          item.capacity,
          item.location,
          isWarehouseLocation(item.location) ? "" : item.client_or_station,
          item.status,
          item.notes,
          item.updated_by
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "") || Number(b.id) - Number(a.id));

  const tbody = document.getElementById("cylinderTableBody");
  const emptyState = document.getElementById("emptyState");

  if (!filtered.length) {
    tbody.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  tbody.innerHTML = filtered.map(item => {
    const locClass = "loc-" + String(item.location || "Di Gudang").replace(/\s+/g, "-");
    const noteHtml = item.notes ? `<div class="note-subtext">${esc(item.notes)}</div>` : "";
    const editorName = item.updated_by ? esc(item.updated_by) : "-";
    const updatedTime = item.updated_at ? `<div class="audit-time">${esc(item.updated_at)}</div>` : "";
    const clientDisplay = isWarehouseLocation(item.location) ? "-" : esc(item.client_or_station || "-");
    return `
      <tr>
        <td><span class="cyl-code">${esc(item.cylinder_number)}</span></td>
        <td><strong>${esc(item.gas_type)}</strong>${noteHtml}</td>
        <td>${esc(item.capacity || "-")}</td>
        <td><span class="badge ${esc(locClass)}">${esc(item.location)}</span></td>
        <td>${clientDisplay}</td>
        <td><span class="status-tag">${esc(item.status || "-")}</span></td>
        <td>${esc(item.last_inspection || "-")}</td>
        <td class="audit-cell">${editorName}${updatedTime}</td>
        <td>
          <div class="actions">
            <button class="btn btn-outline btn-sm" type="button" data-edit-id="${esc(item.id)}">Edit</button>
            <button class="btn btn-danger btn-sm" type="button" data-delete-id="${esc(item.id)}">Hapus</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

/* Modal Tambah / Edit */
function openCylinderModal(item) {
  requireAuth(() => {
    const errEl = document.getElementById("formError");
    errEl.style.display = "none";
    errEl.textContent = "";

    if (item) {
      document.getElementById("modalTitle").textContent = "Edit Tabung Gas";
      document.getElementById("cylinderId").value = item.id;
      document.getElementById("cylinder_number").value = item.cylinder_number || "";
      document.getElementById("gas_type").value = item.gas_type || "Oksigen (O2)";
      document.getElementById("capacity").value = item.capacity || "";
      document.getElementById("status").value = item.status || "Isian";
      document.getElementById("location").value = item.location || "Di Gudang";
      document.getElementById("client_or_station").value = isWarehouseLocation(item.location)
        ? ""
        : (item.client_or_station || "");
      document.getElementById("last_inspection").value = item.last_inspection || "";
      document.getElementById("notes").value = item.notes || "";
    } else {
      document.getElementById("modalTitle").textContent = "Tambah Tabung Gas";
      document.getElementById("cylinderForm").reset();
      document.getElementById("cylinderId").value = "";
      document.getElementById("location").value = "Di Gudang";
    }
    syncClientStationFieldVisibility();
    document.getElementById("formModal").classList.add("open");
  });
}

function deleteCylinderById(id) {
  requireAuth(async () => {
    const item = allCylinders.find(c => Number(c.id) === Number(id));
    if (!item) return;
    if (!confirm(`Hapus tabung ${item.cylinder_number} (${item.gas_type})?`)) return;

    try {
      const result = await postToSheet({ action: "delete", id: item.id });
      if (result.unauthorized) {
        signOutSession();
        showToast(result.error || "Sesi kedaluwarsa. Silakan masuk dengan Google kembali.");
        return;
      }
      if (result.error) {
        showToast("Gagal menghapus: " + result.error);
        return;
      }
      await refreshData();
      showToast(`Tabung ${item.cylinder_number} dihapus`);
    } catch (err) {
      showToast("Kesalahan saat menghapus: " + err.message);
    }
  });
}

/* Ekspor & Impor CSV */
function exportCsv() {
  const headers = [
    "cylinder_number",
    "gas_type",
    "capacity",
    "status",
    "location",
    "client_or_station",
    "last_inspection",
    "notes",
    "updated_at",
    "updated_by"
  ];
  const escapeCell = (val) => {
    const str = String(val ?? "");
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.join(",")];
  allCylinders.forEach(item => {
    const rowObj = {
      ...item,
      client_or_station: isWarehouseLocation(item.location) ? "" : item.client_or_station
    };
    lines.push(headers.map(h => escapeCell(rowObj[h])).join(","));
  });

  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tabung_gas_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Berhasil mengekspor ${allCylinders.length} tabung ke CSV.`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\r" && next === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

/* Event Bindings */
document.getElementById("location").addEventListener("change", syncClientStationFieldVisibility);

document.getElementById("authToggleBtn").addEventListener("click", () => {
  if (isAuthorized()) {
    signOutSession();
  } else {
    openAuthPopup(null);
  }
});

document.getElementById("bannerUnlockBtn").addEventListener("click", () => openAuthPopup(null));

document.getElementById("authCancelBtn").addEventListener("click", () => {
  document.getElementById("authModal").classList.remove("open");
  pendingAuthAction = null;
});

document.getElementById("addBtn").addEventListener("click", () => openCylinderModal(null));
document.getElementById("formCancelBtn").addEventListener("click", () => {
  document.getElementById("formModal").classList.remove("open");
});

document.getElementById("cylinderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const idVal = document.getElementById("cylinderId").value;
  const cylNum = document.getElementById("cylinder_number").value.trim();
  const gasType = document.getElementById("gas_type").value;
  const errEl = document.getElementById("formError");
  const saveBtn = document.getElementById("saveCylinderBtn");

  if (!cylNum || !gasType) {
    errEl.textContent = "Nomor tabung dan jenis gas wajib diisi.";
    errEl.style.display = "block";
    return;
  }

  const duplicate = allCylinders.find(
    c => c.cylinder_number.toLowerCase() === cylNum.toLowerCase() && Number(c.id) !== Number(idVal)
  );
  if (duplicate) {
    errEl.textContent = `Nomor tabung '${cylNum}' sudah terdaftar.`;
    errEl.style.display = "block";
    return;
  }

  const locationVal = document.getElementById("location").value;
  const clientVal = isWarehouseLocation(locationVal)
    ? ""
    : document.getElementById("client_or_station").value.trim();

  const record = {
    id: idVal ? Number(idVal) : 0,
    cylinder_number: cylNum,
    gas_type: gasType,
    capacity: document.getElementById("capacity").value.trim(),
    status: document.getElementById("status").value,
    location: locationVal,
    client_or_station: clientVal,
    last_inspection: document.getElementById("last_inspection").value,
    notes: document.getElementById("notes").value.trim()
  };

  saveBtn.disabled = true;
  saveBtn.textContent = "Menyimpan...";
  try {
    const result = await postToSheet({
      action: idVal ? "update" : "create",
      cylinder: record
    });
    if (result.unauthorized) {
      signOutSession();
      errEl.textContent = result.error || "Sesi kedaluwarsa atau tidak sah. Silakan masuk dengan Google kembali.";
      errEl.style.display = "block";
      return;
    }
    if (result.error) {
      errEl.textContent = result.error;
      errEl.style.display = "block";
      return;
    }
    document.getElementById("formModal").classList.remove("open");
    await refreshData();
    showToast(idVal ? `Tabung ${cylNum} diperbarui` : `Tabung ${cylNum} ditambahkan`);
  } catch (err) {
    errEl.textContent = "Gagal menyimpan: " + err.message;
    errEl.style.display = "block";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Simpan Tabung";
  }
});

document.getElementById("cylinderTableBody").addEventListener("click", (e) => {
  const editId = e.target.getAttribute("data-edit-id");
  if (editId) {
    const item = allCylinders.find(c => Number(c.id) === Number(editId));
    if (item) openCylinderModal(item);
    return;
  }
  const deleteId = e.target.getAttribute("data-delete-id");
  if (deleteId) {
    deleteCylinderById(deleteId);
  }
});

document.getElementById("refreshBtn").addEventListener("click", refreshData);
document.getElementById("exportBtn").addEventListener("click", exportCsv);

document.getElementById("importBtn").addEventListener("click", () => {
  requireAuth(() => document.getElementById("csvFileInput").click());
});

document.getElementById("csvFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const rows = parseCsv(ev.target.result);
      if (rows.length < 2) {
        alert("File CSV harus memiliki baris header dan minimal satu baris data tabung.");
        return;
      }

      const headers = rows[0].map(h => h.trim().toLowerCase());
      const cylIdx = headers.indexOf("cylinder_number");
      const gasIdx = headers.indexOf("gas_type");

      if (cylIdx === -1 || gasIdx === -1) {
        alert("CSV harus memiliki kolom 'cylinder_number' dan 'gas_type'.");
        return;
      }

      const getCol = (r, colName, fallback = "") => {
        const idx = headers.indexOf(colName);
        return idx !== -1 && r[idx] !== undefined ? r[idx].trim() : fallback;
      };

      const parsedRecords = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const cylinder_number = (r[cylIdx] || "").trim();
        const gas_type = (r[gasIdx] || "").trim();
        if (!cylinder_number || !gas_type) continue;

        const locVal = getCol(r, "location", "Di Gudang") || "Di Gudang";
        parsedRecords.push({
          cylinder_number,
          gas_type,
          capacity: getCol(r, "capacity", ""),
          status: getCol(r, "status", "Isian") || "Isian",
          location: locVal,
          client_or_station: isWarehouseLocation(locVal) ? "" : getCol(r, "client_or_station", ""),
          last_inspection: getCol(r, "last_inspection", ""),
          notes: getCol(r, "notes", "")
        });
      }

      showToast("Mengunggah data CSV ke Google Sheet...");
      const res = await postToSheet({ action: "bulk_import", cylinders: parsedRecords });
      if (res.unauthorized) {
        signOutSession();
        alert(res.error || "Tidak sah: Silakan masuk dengan akun Google yang terdaftar.");
        return;
      }
      if (res.error) {
        alert("Kesalahan impor: " + res.error);
        return;
      }
      await refreshData();
      showToast(`Google Sheet tersinkronisasi: ${res.added} ditambahkan, ${res.updated} diperbarui.`);
    } catch (err) {
      alert("Gagal mengimpor CSV: " + err.message);
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
});

document.getElementById("searchInput").addEventListener("input", renderView);
document.getElementById("locationFilter").addEventListener("change", renderView);
document.getElementById("gasFilter").addEventListener("change", renderView);
document.getElementById("statusFilter").addEventListener("change", renderView);

document.getElementById("resetFiltersBtn").addEventListener("click", () => {
  document.getElementById("searchInput").value = "";
  document.getElementById("locationFilter").value = "";
  document.getElementById("gasFilter").value = "";
  document.getElementById("statusFilter").value = "";
  renderView();
});

refreshData();