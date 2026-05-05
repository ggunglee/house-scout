(function () {
  "use strict";

  const RC = window.RentalCompare;
  const WALK_ORIGINS = [
    {
      key: "fromJackson",
      label: "From Jackson",
      lat: 41.3154476,
      lon: -72.9224020
    },
    {
      key: "fromPWG",
      label: "From PWG",
      lat: 41.3162704,
      lon: -72.9301032
    }
  ];
  const WALK_SPEED_KMH = 4.4;
  const WALK_SIGNAL_BUFFER_MINUTES = 1.5;
  const SCRIPT_FILES = [
    "src/utils/cleaning.js",
    "src/extractors/generic.js",
    "src/extractors/zillow.js",
    "src/extractors/apartments.js",
    "src/extractors/eastRock.js",
    "src/extractors/hadley.js",
    "content.js"
  ];

  const state = {
    tabId: null,
    rows: [],
    allCandidates: [],
    candidates: [],
    site: null,
    canUseDetails: false,
    savedRowsCount: 0
  };

  const els = {
    siteLabel: document.getElementById("siteLabel"),
    candidateBtn: document.getElementById("candidateBtn"),
    selectedBtn: document.getElementById("selectedBtn"),
    extractBtn: document.getElementById("extractBtn"),
    detailBtn: document.getElementById("detailBtn"),
    saveBtn: document.getElementById("saveBtn"),
    showSavedBtn: document.getElementById("showSavedBtn"),
    walkBtn: document.getElementById("walkBtn"),
    csvBtn: document.getElementById("csvBtn"),
    jsonBtn: document.getElementById("jsonBtn"),
    clearBtn: document.getElementById("clearBtn"),
    selectAllBtn: document.getElementById("selectAllBtn"),
    selectNoneBtn: document.getElementById("selectNoneBtn"),
    mapBtn: document.getElementById("mapBtn"),
    statusText: document.getElementById("statusText"),
    progressBar: document.getElementById("progressBar"),
    candidateCount: document.getElementById("candidateCount"),
    filteredCount: document.getElementById("filteredCount"),
    rowCount: document.getElementById("rowCount"),
    savedCount: document.getElementById("savedCount"),
    candidateList: document.getElementById("candidateList"),
    resultsBody: document.getElementById("resultsBody"),
    candidateTextFilter: document.getElementById("candidateTextFilter"),
    maxRentFilter: document.getElementById("maxRentFilter"),
    minBedsFilter: document.getElementById("minBedsFilter"),
    clearFiltersBtn: document.getElementById("clearFiltersBtn")
  };

  function setStatus(text, isError) {
    els.statusText.textContent = text;
    els.statusText.classList.toggle("error", Boolean(isError));
  }

  function selectedIds() {
    return Array.from(els.candidateList.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value);
  }

  function selectedCandidates() {
    const ids = new Set(selectedIds());
    return state.candidates.filter((candidate) => ids.has(candidate.candidateId));
  }

  function hasMappableAddress(candidate) {
    const lat = candidate && (candidate.lat || candidate.latitude);
    const lon = candidate && (candidate.lon || candidate.lng || candidate.longitude);
    const hasCoordinates = lat != null && lat !== "" && lon != null && lon !== "";
    return Boolean(candidate && (candidate.address || candidate.location || hasCoordinates));
  }

  function setBusy(isBusy) {
    const hasRows = state.rows.length > 0;
    const hasExportableRows = hasRows || state.savedRowsCount > 0;
    const hasCandidates = state.candidates.length > 0;
    const hasSelected = selectedIds().length > 0;
    els.candidateBtn.disabled = isBusy;
    els.extractBtn.disabled = isBusy;
    els.selectedBtn.disabled = isBusy || !hasCandidates || !hasSelected;
    els.detailBtn.disabled = isBusy || !state.canUseDetails || !hasCandidates || !hasSelected;
    els.saveBtn.disabled = isBusy || !hasRows;
    els.walkBtn.disabled = isBusy || !hasExportableRows;
    els.csvBtn.disabled = isBusy || !hasExportableRows;
    els.jsonBtn.disabled = isBusy || !hasExportableRows;
    els.selectAllBtn.disabled = isBusy || !hasCandidates;
    els.selectNoneBtn.disabled = isBusy || !hasCandidates;
    els.mapBtn.disabled = isBusy || !selectedCandidates().some(hasMappableAddress);
  }

  function formatValue(value) {
    if (Array.isArray(value)) return value.join("; ");
    if (value == null || value === "") return "";
    return String(value);
  }

  function parseRent(row) {
    if (row.rent != null && row.rent !== "") return Number(row.rent);
    const match = String(row.rentText || "").match(/[0-9][0-9,]*/);
    return match ? Number(match[0].replace(/,/g, "")) : null;
  }

  function parseBeds(row) {
    if (row.beds === "Studio") return 0;
    if (row.beds != null && row.beds !== "") return Number(row.beds);
    const text = [row.candidateLabel, row.title, row.name, row.unitSize].filter(Boolean).join(" ").toLowerCase();
    if (/\bstudio\b/.test(text)) return 0;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:bd|bed|beds|bedroom|bedrooms)\b/);
    return match ? Number(match[1]) : null;
  }

  function candidateSearchText(candidate) {
    return [
      candidate.candidateLabel,
      candidate.title,
      candidate.name,
      candidate.address,
      candidate.unitSize,
      candidate.rentText,
      candidate.candidateType
    ].map(formatValue).join(" ").toLowerCase();
  }

  function matchesCandidateFilters(candidate) {
    const query = (els.candidateTextFilter.value || "").trim().toLowerCase();
    const maxRent = els.maxRentFilter.value ? Number(els.maxRentFilter.value) : null;
    const minBeds = els.minBedsFilter.value === "" ? null : Number(els.minBedsFilter.value);
    if (query && !candidateSearchText(candidate).includes(query)) return false;
    const rent = parseRent(candidate);
    if (maxRent != null && (rent == null || rent > maxRent)) return false;
    const beds = parseBeds(candidate);
    if (minBeds != null && (beds == null || beds < minBeds)) return false;
    return true;
  }

  function applyCandidateFilters() {
    state.candidates = state.allCandidates.filter(matchesCandidateFilters);
    renderCandidates();
  }

  function normalizeRowsForOutput(rows) {
    return RC.normalizeRowsForOutput ? RC.normalizeRowsForOutput(rows) : (rows || []);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function cleanAddressForGeocode(address) {
    const text = String(address || "").replace(/\s+/g, " ").trim();
    const match = text.match(/^(.+),\s*([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s+\d{5})?\b/);
    if (!match) return text;
    let street = match[1]
      .replace(/\s+-\s*Unit\s+[A-Za-z0-9-]+.*$/i, "")
      .replace(/\s+-\s*(?:Apt|Apartment|Unit|Suite|Ste|Floor|Fl|#)\.?\s*[A-Za-z0-9-]+.*$/i, "")
      .replace(/\s+-\s*\d+\s+[A-Za-z0-9 .'-]+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Drive|Dr\.?|Place|Pl\.?|Court|Ct\.?|Lane|Ln\.?|Parkway|Pkwy|Boulevard|Blvd)\b.*$/i, "")
      .replace(/\s+-\s*[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*.*$/i, "")
      .replace(/^(\d+)\s*-\s*\d+(\s+)/, "$1$2")
      .replace(/\s+-\s*(?:apt|apartment|unit|suite|ste|floor|fl|#)?\s*[A-Za-z0-9-]+$/i, "")
      .trim();
    return `${street}, ${match[2].trim()}, ${match[3].trim()}`;
  }

  async function geocodeAddress(address) {
    const query = cleanAddressForGeocode(address);
    if (!query) return null;
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "1",
      countrycodes: "us",
      viewbox: "-73.05,41.39,-72.83,41.22",
      bounded: "1"
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    if (!response.ok) return null;
    const data = await response.json();
    const first = data && data[0];
    const lat = first ? asNumber(first.lat) : null;
    const lon = first ? asNumber(first.lon) : null;
    return lat != null && lon != null ? { lat, lon } : null;
  }

  function haversineKm(from, to) {
    const radiusKm = 6371;
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLon = (to.lon - from.lon) * Math.PI / 180;
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function gridWalkKm(from, to) {
    const radiusKm = 6371;
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;
    const dLat = Math.abs((to.lat - from.lat) * Math.PI / 180);
    const dLon = Math.abs((to.lon - from.lon) * Math.PI / 180);
    const northSouthKm = radiusKm * dLat;
    const eastWestKm = radiusKm * Math.cos((lat1 + lat2) / 2) * dLon;
    return northSouthKm + eastWestKm;
  }

  function estimatedWalkMinutes(from, to) {
    const directKm = haversineKm(from, to);
    const gridKm = gridWalkKm(from, to);
    const routeKm = Math.max(directKm * 1.35, gridKm * 0.92);
    const movingMinutes = (routeKm / WALK_SPEED_KMH) * 60;
    const crossingBuffer = Math.min(4, Math.max(1, routeKm * WALK_SIGNAL_BUFFER_MINUTES));
    return Math.round(movingMinutes + crossingBuffer);
  }

  function walkTimeText(minutes) {
    if (!Number.isFinite(minutes)) return "";
    if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins ? `${hours} hr ${mins} min` : `${hours} hr`;
  }

  async function calculateWalkTimes() {
    const rows = await exportRows();
    if (!rows.length) {
      setStatus("보행 시간을 계산할 결과가 없습니다.", true);
      return;
    }

    setBusy(true);
    els.progressBar.hidden = false;
    els.progressBar.value = 0;
    const cache = new Map();
    try {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const key = cleanAddressForGeocode(row.address);
        setStatus(`보행 시간 계산 중 ${index + 1}/${rows.length}: ${key || row.name || ""}`);
        if (!key) continue;

        let point = cache.get(key);
        if (!point) {
          point = await geocodeAddress(key);
          cache.set(key, point || false);
          if (index < rows.length - 1) await sleep(1100);
        } else if (point === false) {
          point = null;
        }

        if (point) {
          for (const origin of WALK_ORIGINS) {
            const minutes = estimatedWalkMinutes(origin, point);
            row[`${origin.key}Minutes`] = minutes;
            row[origin.key] = walkTimeText(minutes);
          }
        }
        els.progressBar.value = Math.round(((index + 1) / rows.length) * 100);
      }
      state.rows = rows;
      renderRows();
      const saved = await RC.saveRows(rows);
      state.savedRowsCount = saved.length;
      els.savedCount.textContent = `저장 ${saved.length}개`;
      setStatus(`${rows.length}개 행의 From Jackson / From PWG 시간을 계산했습니다.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      els.progressBar.hidden = true;
      setBusy(false);
    }
  }

  function renderRows() {
    els.rowCount.textContent = `결과 ${state.rows.length}개`;
    const sheetRows = RC.rowsToSheetRows ? RC.rowsToSheetRows(state.rows) : state.rows;
    if (!state.rows.length) {
      els.resultsBody.innerHTML = '<tr><td colspan="8" class="empty">아직 표시할 결과가 없습니다.</td></tr>';
      setBusy(false);
      return;
    }
    els.resultsBody.textContent = "";
    for (const row of sheetRows) {
      const tr = document.createElement("tr");
      [row.name, row.area, row.rent, row.utilities, row.laundry, row.fromJackson, row.features, row.details]
        .forEach((value) => {
          const td = document.createElement("td");
          td.textContent = formatValue(value);
          td.title = formatValue(value);
          tr.appendChild(td);
        });
      els.resultsBody.appendChild(tr);
    }
    setBusy(false);
  }

  function renderCandidates() {
    els.candidateCount.textContent = `후보 ${state.allCandidates.length || state.candidates.length}개`;
    els.filteredCount.textContent = `필터 ${state.candidates.length}개`;
    if (!state.candidates.length) {
      els.candidateList.innerHTML = '<div class="empty">후보를 찾지 못했습니다.</div>';
      setBusy(false);
      return;
    }

    els.candidateList.textContent = "";
    for (const [index, candidate] of state.candidates.entries()) {
      candidate.displayNumber = index + 1;
      const label = document.createElement("label");
      label.className = "candidate-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = candidate.candidateId;
      checkbox.checked = true;
      checkbox.addEventListener("change", () => setBusy(false));

      const number = document.createElement("span");
      number.className = "candidate-number";
      number.textContent = String(candidate.displayNumber);

      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "candidate-title";
      title.textContent = candidate.candidateLabel || candidate.title || candidate.name || candidate.candidateId;

      const meta = document.createElement("div");
      meta.className = "candidate-meta";
      meta.textContent = [candidate.address, candidate.candidateType].filter(Boolean).join(" | ");

      body.append(title, meta);
      label.append(checkbox, number, body);
      els.candidateList.appendChild(label);
    }
    setBusy(false);
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("현재 탭을 찾지 못했습니다.");
    state.tabId = tab.id;
    return tab;
  }

  async function sendMessage(message) {
    await chrome.scripting.executeScript({ target: { tabId: state.tabId }, files: SCRIPT_FILES });
    return chrome.tabs.sendMessage(state.tabId, message);
  }

  function appfolioUrlFromWarnings(warnings) {
    const warning = (warnings || []).find((item) => String(item).startsWith("APPFOLIO_URL:"));
    return warning ? warning.replace("APPFOLIO_URL:", "") : null;
  }

  async function extractEmbeddedAppfolio(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`AppFolio 목록을 가져오지 못했습니다. HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const base = doc.createElement("base");
    base.href = url;
    doc.head.prepend(base);
    const rows = RC.extractEastRockCandidates(doc).map((row) => Object.assign(row, {
      pageUrl: url,
      raw: Object.assign({}, row.raw || {}, { embeddedSource: url })
    }));
    return RC.dedupeRows ? RC.dedupeRows(rows) : rows;
  }

  async function refreshSavedCount() {
    const saved = await RC.getSavedRows();
    state.savedRowsCount = saved.length;
    els.savedCount.textContent = `저장 ${saved.length}개`;
    return saved;
  }

  async function detectCurrentPage() {
    await getActiveTab();
    const response = await sendMessage({ type: "PING" });
    state.site = response.site;
    state.canUseDetails = Boolean(response.canUseDetails);
    els.siteLabel.textContent = `감지된 사이트: ${response.site}`;
    setBusy(false);
  }

  async function findCandidates() {
    setBusy(true);
    setStatus("유닛 후보를 찾는 중...");
    try {
      const response = await sendMessage({ type: "GET_CANDIDATES" });
      if (!response || !response.ok) throw new Error(response && response.error ? response.error : "후보 추출 실패");
      state.allCandidates = RC.dedupeRows ? RC.dedupeRows(response.candidates || []) : (response.candidates || []);
      const appfolioUrl = state.allCandidates.length ? null : appfolioUrlFromWarnings(response.warnings);
      if (appfolioUrl) {
        setStatus("East Rock AppFolio 후보를 가져오는 중...");
        state.allCandidates = await extractEmbeddedAppfolio(appfolioUrl);
      }
      applyCandidateFilters();
      setStatus(`${state.candidates.length}개 후보를 찾았습니다. 원하는 항목만 선택하세요.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function extractAll(mode) {
    if (state.allCandidates.length) {
      await extractSelected(mode);
      return;
    }

    setBusy(true);
    els.progressBar.hidden = mode !== "details";
    els.progressBar.value = 0;
    setStatus(mode === "details" ? "상세 페이지를 순차적으로 가져오는 중..." : "현재 페이지의 모든 보이는 항목을 추출하는 중...");

    try {
      const response = await sendMessage({ type: "EXTRACT", mode });
      if (!response || !response.ok) throw new Error(response && response.error ? response.error : "추출 실패");
      state.rows = normalizeRowsForOutput(RC.dedupeRows ? RC.dedupeRows(response.rows || []) : (response.rows || []));
      const appfolioUrl = state.rows.length ? null : appfolioUrlFromWarnings(response.warnings);
      if (appfolioUrl) {
        setStatus("East Rock AppFolio 목록을 가져오는 중...");
        state.rows = normalizeRowsForOutput(await extractEmbeddedAppfolio(appfolioUrl));
      }
      state.site = response.site;
      renderRows();
      setStatus(`${state.rows.length}개 행을 추출했습니다.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      els.progressBar.hidden = true;
      setBusy(false);
    }
  }

  async function extractSelected(mode) {
    const ids = selectedIds();
    if (!ids.length) {
      setStatus("먼저 후보를 선택하세요.", true);
      return;
    }

    setBusy(true);
    els.progressBar.hidden = mode !== "details";
    els.progressBar.value = 0;
    setStatus(mode === "details" ? "선택한 후보의 상세 정보를 가져오는 중..." : "선택한 후보만 결과로 확정하는 중...");

    try {
      if (state.site === "eastRock" && state.candidates.some((candidate) => candidate.raw && candidate.raw.embeddedSource)) {
        state.rows = normalizeRowsForOutput(state.candidates.filter((candidate) => ids.includes(candidate.candidateId)));
      } else {
        const response = await sendMessage({ type: "EXTRACT_SELECTED", candidateIds: ids, mode });
        if (!response || !response.ok) throw new Error(response && response.error ? response.error : "선택 항목 추출 실패");
        state.rows = normalizeRowsForOutput(RC.dedupeRows ? RC.dedupeRows(response.rows || []) : (response.rows || []));
      }
      renderRows();
      setStatus(`${state.rows.length}개 선택 결과를 추출했습니다.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      els.progressBar.hidden = true;
      setBusy(false);
    }
  }

  async function showSavedRows() {
    setBusy(true);
    const saved = await refreshSavedCount();
    state.rows = normalizeRowsForOutput(saved);
    renderRows();
    setStatus(`${saved.length}개 저장 결과를 표시했습니다.`);
  }

  async function exportRows() {
    const saved = await refreshSavedCount();
    if (saved.length) {
      state.rows = normalizeRowsForOutput(saved);
      renderRows();
      return state.rows;
    }
    return state.rows;
  }

  function mapCandidate(candidate, index) {
    const fields = [
      "id", "site", "sourceType", "candidateId", "candidateLabel", "candidateType", "displayNumber",
      "name", "title", "address", "location", "unitSize", "rent", "rentText", "minRent", "maxRent",
      "beds", "baths", "sqft", "area", "available", "utilitiesIncluded", "utilities", "laundry",
      "amenities", "appliances", "parking", "pets", "description", "imageUrl", "detailUrl", "pageUrl",
      "latitude", "longitude", "lat", "lon", "lng", "phone", "applicationFee", "capturedAt"
    ];
    const output = {};
    for (const key of fields) {
      const value = candidate[key];
      if (value == null) continue;
      if (["string", "number", "boolean"].includes(typeof value)) {
        output[key] = value;
      } else if (Array.isArray(value)) {
        output[key] = value
          .filter((item) => item != null && ["string", "number", "boolean"].includes(typeof item))
          .slice(0, 40);
      }
    }

    return Object.assign(output, {
      candidateId: candidate.candidateId,
      displayNumber: candidate.displayNumber || index + 1,
      candidateLabel: candidate.candidateLabel,
      rentText: candidate.rentText || candidate.rent,
      lat: candidate.lat || candidate.latitude,
      lon: candidate.lon || candidate.lng || candidate.longitude
    });
  }

  async function openCandidateMap() {
    const candidates = selectedCandidates().filter(hasMappableAddress).map(mapCandidate);
    if (!candidates.length) {
      setStatus("지도에 표시할 주소가 있는 후보를 먼저 선택하세요.", true);
      return;
    }

    try {
      await chrome.storage.local.set({
        mapCandidates: candidates,
        mapSourceTabId: state.tabId,
        mapSourceSite: state.site,
        mapCanUseDetails: state.canUseDetails,
        mapSelectedCandidateIds: candidates.map((candidate) => candidate.candidateId),
        mapCreatedAt: new Date().toISOString()
      });
      await chrome.tabs.create({ url: chrome.runtime.getURL("map.html") });
      setStatus(`${candidates.length}개 후보를 지도에 보냈습니다.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "EXTRACT_PROGRESS") return;
    const total = message.total || 0;
    const current = message.current || 0;
    if (total > 0) {
      els.progressBar.hidden = false;
      els.progressBar.value = Math.round((current / total) * 100);
    }
    setStatus(`상세 ${current}/${total}: ${message.label || message.url || ""}`);
  });

  els.candidateBtn.addEventListener("click", findCandidates);
  els.extractBtn.addEventListener("click", () => extractAll("basic"));
  els.selectedBtn.addEventListener("click", () => extractSelected("basic"));
  els.detailBtn.addEventListener("click", () => extractSelected("details"));
  els.showSavedBtn.addEventListener("click", showSavedRows);
  els.walkBtn.addEventListener("click", calculateWalkTimes);
  els.mapBtn.addEventListener("click", openCandidateMap);
  [els.candidateTextFilter, els.maxRentFilter, els.minBedsFilter].forEach((input) => {
    input.addEventListener("input", applyCandidateFilters);
    input.addEventListener("change", applyCandidateFilters);
  });
  els.clearFiltersBtn.addEventListener("click", () => {
    els.candidateTextFilter.value = "";
    els.maxRentFilter.value = "";
    els.minBedsFilter.value = "";
    applyCandidateFilters();
  });
  els.selectAllBtn.addEventListener("click", () => {
    els.candidateList.querySelectorAll("input[type='checkbox']").forEach((input) => { input.checked = true; });
    setBusy(false);
  });
  els.selectNoneBtn.addEventListener("click", () => {
    els.candidateList.querySelectorAll("input[type='checkbox']").forEach((input) => { input.checked = false; });
    setBusy(false);
  });
  els.saveBtn.addEventListener("click", async () => {
    const saved = await RC.saveRows(state.rows);
    state.savedRowsCount = saved.length;
    els.savedCount.textContent = `저장 ${saved.length}개`;
    setBusy(false);
    setStatus("현재 결과를 로컬 저장소에 저장했습니다.");
  });
  els.csvBtn.addEventListener("click", async () => {
    const rows = await exportRows();
    if (!rows.length) {
      setStatus("복사할 결과가 없습니다.", true);
      return;
    }
    const sheetRows = RC.rowsToSheetRows ? RC.rowsToSheetRows(rows) : rows;
    await navigator.clipboard.writeText(RC.rowsToTsv(rows));
    setStatus(`${sheetRows.length}개 행을 구글 문서/시트에 붙여넣기 좋은 표 형식으로 복사했습니다.`);
  });
  els.jsonBtn.addEventListener("click", async () => {
    const rows = await exportRows();
    if (!rows.length) {
      setStatus("복사할 결과가 없습니다.", true);
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
    setStatus("JSON을 클립보드에 복사했습니다.");
  });
  els.clearBtn.addEventListener("click", async () => {
    await RC.clearSavedRows();
    state.rows = [];
    renderRows();
    await refreshSavedCount();
    setStatus("저장된 결과를 삭제했습니다.");
  });

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await refreshSavedCount();
      await detectCurrentPage();
      setStatus("대기 중");
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  });
})();
