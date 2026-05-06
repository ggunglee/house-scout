(function () {
  "use strict";

  const TILE_SIZE = 256;
  const DEFAULT_CENTER = { lat: 41.3083, lon: -72.9279 };
  const WALK_ORIGINS = [
    {
      key: "fromJackson",
      lat: 41.3154476,
      lon: -72.9224020
    },
    {
      key: "fromPWG",
      lat: 41.3162704,
      lon: -72.9301032
    }
  ];
  const WALK_SPEED_KMH = 4.4;
  const WALK_SIGNAL_BUFFER_MINUTES = 1.5;
  const LOCALITY_BOUNDS = {
    "new haven, ct": "-73.05,41.39,-72.83,41.22"
  };
  const els = {
    map: document.getElementById("map"),
    status: document.getElementById("mapStatus"),
    list: document.getElementById("candidateList"),
    selectionCount: document.getElementById("selectionCount"),
    selectAllBtn: document.getElementById("selectAllBtn"),
    selectNoneBtn: document.getElementById("selectNoneBtn"),
    extractBtn: document.getElementById("extractBtn"),
    detailBtn: document.getElementById("detailBtn"),
    saveBtn: document.getElementById("saveBtn"),
    showSavedBtn: document.getElementById("showSavedBtn"),
    copyBtn: document.getElementById("copyBtn"),
    jsonBtn: document.getElementById("jsonBtn"),
    clearBtn: document.getElementById("clearBtn"),
    rowCount: document.getElementById("rowCount"),
    savedCount: document.getElementById("savedCount"),
    resultsBody: document.getElementById("resultsBody"),
    fitBtn: document.getElementById("fitBtn"),
    zoomInBtn: document.getElementById("zoomInBtn"),
    zoomOutBtn: document.getElementById("zoomOutBtn")
  };
  const RC = window.RentalCompare || {};
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
    candidates: [],
    selectedIds: new Set(),
    rows: [],
    sourceTabId: null,
    canUseDetails: false,
    savedRowsCount: 0,
    center: DEFAULT_CENTER,
    zoom: 13,
    isDragging: false,
    dragStart: null,
    dragCenter: null,
    activeCandidateNumber: null
  };

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.style.color = isError ? "var(--warn)" : "";
  }

  function setBusy(isBusy) {
    const selectedCount = state.selectedIds.size;
    els.extractBtn.disabled = isBusy || !selectedCount;
    els.detailBtn.disabled = isBusy || !selectedCount || !state.sourceTabId || !state.canUseDetails;
    els.saveBtn.disabled = isBusy || !state.rows.length;
    els.copyBtn.disabled = isBusy || !state.rows.length;
    els.jsonBtn.disabled = isBusy || !state.rows.length;
    els.showSavedBtn.disabled = isBusy;
    els.clearBtn.disabled = isBusy;
    els.selectAllBtn.disabled = isBusy || !state.candidates.length;
    els.selectNoneBtn.disabled = isBusy || !state.candidates.length;
  }

  function normalizeRowsForOutput(rows) {
    return RC.normalizeRowsForOutput ? RC.normalizeRowsForOutput(rows) : (rows || []);
  }

  function selectedCandidates() {
    return state.candidates.filter((candidate) => state.selectedIds.has(candidate.candidateId));
  }

  function formatValue(value) {
    if (Array.isArray(value)) return value.join("; ");
    if (value == null || value === "") return "";
    return String(value);
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

  function renderRows() {
    els.rowCount.textContent = `Rows ${state.rows.length}`;
    const sheetRows = RC.rowsToSheetRows ? RC.rowsToSheetRows(state.rows) : state.rows;
    if (!state.rows.length) {
      els.resultsBody.innerHTML = '<tr><td colspan="9" class="empty">No extracted results yet.</td></tr>';
      setBusy(false);
      return;
    }

    els.resultsBody.textContent = "";
    for (const row of sheetRows) {
      const tr = document.createElement("tr");
      [row.name, row.address, row.area, row.rent, row.utilities, row.laundry, row.fromJackson, row.features, row.details]
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

  async function refreshSavedCount() {
    const saved = await RC.getSavedRows();
    state.savedRowsCount = saved.length;
    els.savedCount.textContent = `Saved ${saved.length}`;
    return saved;
  }

  async function persistSelection() {
    await chrome.storage.local.set({
      mapSelectedCandidateIds: Array.from(state.selectedIds)
    });
  }

  function updateSelectionCount() {
    els.selectionCount.textContent = `Selected ${state.selectedIds.size}/${state.candidates.length}`;
    setBusy(false);
  }

  async function toggleCandidate(candidateId, checked) {
    if (checked) {
      state.selectedIds.add(candidateId);
    } else {
      state.selectedIds.delete(candidateId);
    }
    state.rows = [];
    renderRows();
    await persistSelection();
    renderMap();
    renderList();
  }

  async function sendSourceMessage(message) {
    if (!state.sourceTabId) throw new Error("The original listing tab was not recorded. Reopen the popup from the listing page and open the map again.");
    await chrome.scripting.executeScript({ target: { tabId: state.sourceTabId }, files: SCRIPT_FILES });
    return chrome.tabs.sendMessage(state.sourceTabId, message);
  }

  function fallbackRowsFromSelection() {
    return selectedCandidates().map((candidate) => Object.assign({}, candidate, {
      site: candidate.site || "map",
      sourceType: candidate.candidateType || "candidate",
      rent: candidate.rent || candidate.rentText,
      pageUrl: candidate.pageUrl || candidate.detailUrl || ""
    }));
  }

  function hasValue(value) {
    return value != null && value !== "" && (!Array.isArray(value) || value.length > 0);
  }

  function mergeFilled(base, incoming) {
    const output = Object.assign({}, base || {});
    for (const [key, value] of Object.entries(incoming || {})) {
      if (hasValue(value) || !hasValue(output[key])) output[key] = value;
    }
    return output;
  }

  function mergeRowsWithSelection(rows) {
    const fallbackRows = fallbackRowsFromSelection();
    if (!rows || !rows.length) return fallbackRows;

    const fallbackById = new Map(fallbackRows.map((row) => [row.candidateId, row]));
    const merged = rows.map((row) => mergeFilled(fallbackById.get(row.candidateId), row));
    return RC.dedupeRows ? RC.dedupeRows(merged) : merged;
  }

  async function extractSelected(mode) {
    const candidateIds = Array.from(state.selectedIds);
    if (!candidateIds.length) {
      setStatus("Select at least one candidate first.", true);
      return;
    }

    setBusy(true);
    setStatus(mode === "details" ? `Extracting details for ${candidateIds.length} selected candidates...` : `Extracting ${candidateIds.length} selected candidates...`);
    try {
      const response = await sendSourceMessage({ type: "EXTRACT_SELECTED", candidateIds, mode });
      if (!response || !response.ok) throw new Error(response && response.error ? response.error : "Extraction failed.");
      const rows = RC.dedupeRows ? RC.dedupeRows(response.rows || []) : (response.rows || []);
      state.rows = normalizeRowsForOutput(mergeRowsWithSelection(rows));
      if (mode === "details") {
        state.rows = await addWalkTimesToRows(state.rows);
      }
      renderRows();
      setStatus(mode === "details"
        ? `Extracted ${state.rows.length} rows with walk times. You can save them or copy the table from this map tab.`
        : `Extracted ${state.rows.length} rows. You can save them or copy the table from this map tab.`);
    } catch (error) {
      if (mode === "basic") {
        state.rows = normalizeRowsForOutput(fallbackRowsFromSelection());
        renderRows();
        setStatus(`Used the selected map candidates as ${state.rows.length} rows because the original tab could not be reached.`);
      } else {
        setStatus(error.message || String(error), true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveRows() {
    setBusy(true);
    try {
      const saved = await RC.saveRows(state.rows);
      state.savedRowsCount = saved.length;
      els.savedCount.textContent = `Saved ${saved.length}`;
      setStatus(`Saved ${state.rows.length} rows. Local storage now has ${saved.length} rows.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function copyRows() {
    setBusy(true);
    try {
      await navigator.clipboard.writeText(RC.rowsToTsv ? RC.rowsToTsv(state.rows) : JSON.stringify(state.rows, null, 2));
      setStatus(`Copied ${state.rows.length} rows.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function copyJson() {
    setBusy(true);
    try {
      await navigator.clipboard.writeText(JSON.stringify(state.rows, null, 2));
      setStatus(`Copied ${state.rows.length} full JSON rows.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function showSavedRows() {
    setBusy(true);
    try {
      const saved = await refreshSavedCount();
      state.rows = normalizeRowsForOutput(saved);
      renderRows();
      setStatus(`Showing ${saved.length} saved rows.`);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function clearSavedRows() {
    setBusy(true);
    try {
      await RC.clearSavedRows();
      state.rows = [];
      renderRows();
      await refreshSavedCount();
      setStatus("Cleared saved rows.");
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  }

  function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function titleFor(candidate) {
    return candidate.candidateLabel || candidate.title || candidate.name || `Candidate ${candidate.number}`;
  }

  function addressFor(candidate) {
    return candidate.address || candidate.location || "";
  }

  function detailLinesFor(candidate) {
    return [
      candidate.address || candidate.location,
      candidate.unitSize,
      candidate.rentText || candidate.rent
    ].map(cleanText).filter(Boolean);
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function inferLocality() {
    const counts = new Map();
    for (const candidate of state.candidates) {
      const match = cleanText(addressFor(candidate)).match(/,\s*([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s+\d{5})?\b/);
      if (!match) continue;
      const locality = `${match[1].trim()}, ${match[2].trim()}`;
      counts.set(locality, (counts.get(locality) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }

  function streetQueryFromAddress(address, locality) {
    const text = cleanText(address);
    const fullMatch = text.match(/^(.*?),\s*([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s+\d{5})?\b/);
    let street = fullMatch ? fullMatch[1] : text;
    const cityState = fullMatch ? `${fullMatch[2].trim()}, ${fullMatch[3].trim()}` : locality;

    street = street
      .replace(/\s*,\s*(?:apt|apartment|unit|suite|ste|floor|fl|#)\.?\s*#?\s*[A-Za-z0-9-]+.*$/i, "")
      .replace(/\s*,\s*#?\s*[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/i, "")
      .replace(/^(\d+)\s*-\s*\d+(\s+)/, "$1$2")
      .replace(/\s+-\s*(?:apt|apartment|unit|suite|ste|floor|fl|#)?\s*[A-Za-z0-9-]+$/i, "")
      .replace(/\s+#\s*[A-Za-z0-9-]+$/i, "")
      .replace(/\s+(?:apt|apartment|unit|suite|ste|floor|fl)\s+[A-Za-z0-9-]+$/i, "")
      .trim();

    if (!street || !cityState) return text;
    return `${street}, ${cityState}`;
  }

  async function searchAddress(query) {
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "1",
      countrycodes: "us",
      addressdetails: "1"
    });
    const bounds = LOCALITY_BOUNDS[String(state.localityHint || "").toLowerCase()];
    if (bounds) {
      params.set("viewbox", bounds);
      params.set("bounded", "1");
    }

    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data && data[0] ? data[0] : null;
  }

  async function pointForRow(row, cache) {
    const lat = asNumber(row.lat || row.latitude);
    const lon = asNumber(row.lon || row.lng || row.longitude);
    if (lat != null && lon != null) return { lat, lon };

    const query = streetQueryFromAddress(row.address || row.location, state.localityHint);
    if (!query) return null;

    if (cache.has(query)) {
      const cached = cache.get(query);
      return cached === false ? null : cached;
    }

    const first = await searchAddress(query);
    const foundLat = first ? asNumber(first.lat) : null;
    const foundLon = first ? asNumber(first.lon) : null;
    const point = foundLat != null && foundLon != null ? { lat: foundLat, lon: foundLon } : null;
    cache.set(query, point || false);
    return point;
  }

  async function addWalkTimesToRows(rows) {
    const cache = new Map();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      setStatus(`Calculating walk time ${index + 1}/${rows.length}: ${streetQueryFromAddress(row.address || row.location, state.localityHint) || row.name || ""}`);
      const point = await pointForRow(row, cache);
      if (point) {
        for (const origin of WALK_ORIGINS) {
          const minutes = estimatedWalkMinutes(origin, point);
          row[`${origin.key}Minutes`] = minutes;
          row[origin.key] = walkTimeText(minutes);
        }
      }
      if (index < rows.length - 1) await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    return rows;
  }

  function worldSize(zoom) {
    return TILE_SIZE * Math.pow(2, zoom);
  }

  function project(lat, lon, zoom) {
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const clamped = Math.min(Math.max(sinLat, -0.9999), 0.9999);
    const size = worldSize(zoom);
    return {
      x: ((lon + 180) / 360) * size,
      y: (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * size
    };
  }

  function unproject(x, y, zoom) {
    const size = worldSize(zoom);
    const lon = (x / size) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / size;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat, lon };
  }

  function clearMap() {
    Array.from(els.map.querySelectorAll(".tile, .marker, .map-info")).forEach((node) => node.remove());
  }

  function addTile(x, y, z, left, top) {
    const img = document.createElement("img");
    img.className = "tile";
    img.alt = "";
    img.draggable = false;
    const subdomain = ["a", "b", "c", "d"][Math.abs(x + y) % 4];
    img.src = `https://${subdomain}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
    img.style.left = `${left}px`;
    img.style.top = `${top}px`;
    els.map.appendChild(img);
  }

  function addMarker(candidate, topLeft) {
    const point = project(candidate.lat, candidate.lon, state.zoom);
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `marker${state.activeCandidateNumber === candidate.number ? " active" : ""}${state.selectedIds.has(candidate.candidateId) ? "" : " unselected"}`;
    marker.textContent = String(candidate.number);
    marker.title = `${titleFor(candidate)}\n${addressFor(candidate)}`;
    const left = point.x - topLeft.x + (candidate.offsetX || 0);
    const top = point.y - topLeft.y + (candidate.offsetY || 0);
    marker.style.left = `${left}px`;
    marker.style.top = `${top}px`;
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      selectCandidate(candidate.number);
    });
    els.map.appendChild(marker);
  }

  function addInfoPanel(candidate, topLeft) {
    if (!candidate || candidate.lat == null || candidate.lon == null) return;
    const rect = els.map.getBoundingClientRect();
    const point = project(candidate.lat, candidate.lon, state.zoom);
    const left = point.x - topLeft.x + (candidate.offsetX || 0);
    const top = point.y - topLeft.y + (candidate.offsetY || 0);
    const panel = document.createElement("section");
    panel.className = "map-info";
    panel.style.left = `${Math.min(Math.max(left + 16, 12), rect.width - 292)}px`;
    panel.style.top = `${Math.min(Math.max(top - 88, 12), rect.height - 172)}px`;

    const header = document.createElement("div");
    header.className = "map-info-header";
    const number = document.createElement("span");
    number.className = "map-info-number";
    number.textContent = String(candidate.number);
    const title = document.createElement("strong");
    title.textContent = titleFor(candidate);
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "x";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      state.activeCandidateNumber = null;
      renderMap();
      renderList();
    });
    header.append(number, title, close);
    panel.appendChild(header);

    for (const line of detailLinesFor(candidate)) {
      const row = document.createElement("div");
      row.className = "map-info-line";
      row.textContent = line;
      panel.appendChild(row);
    }

    els.map.appendChild(panel);
  }

  function renderMap() {
    clearMap();
    const rect = els.map.getBoundingClientRect();
    const centerPoint = project(state.center.lat, state.center.lon, state.zoom);
    const topLeft = {
      x: centerPoint.x - rect.width / 2,
      y: centerPoint.y - rect.height / 2
    };
    const maxTile = Math.pow(2, state.zoom);
    const startX = Math.floor(topLeft.x / TILE_SIZE);
    const endX = Math.floor((topLeft.x + rect.width) / TILE_SIZE);
    const startY = Math.floor(topLeft.y / TILE_SIZE);
    const endY = Math.floor((topLeft.y + rect.height) / TILE_SIZE);

    for (let x = startX; x <= endX; x += 1) {
      for (let y = startY; y <= endY; y += 1) {
        if (y < 0 || y >= maxTile) continue;
        const wrappedX = ((x % maxTile) + maxTile) % maxTile;
        addTile(wrappedX, y, state.zoom, x * TILE_SIZE - topLeft.x, y * TILE_SIZE - topLeft.y);
      }
    }

    state.candidates.filter((candidate) => candidate.lat != null && candidate.lon != null).forEach((candidate) => addMarker(candidate, topLeft));
    addInfoPanel(state.candidates.find((candidate) => candidate.number === state.activeCandidateNumber), topLeft);
  }

  function renderList() {
    els.list.textContent = "";
    for (const candidate of state.candidates) {
      const item = document.createElement("li");
      item.id = `candidate-${candidate.number}`;
      item.className = `candidate-row${candidate.geocodeFailed ? " failed" : ""}${state.activeCandidateNumber === candidate.number ? " active" : ""}${state.selectedIds.has(candidate.candidateId) ? "" : " unselected"}`;
      item.addEventListener("click", () => selectCandidate(candidate.number));

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedIds.has(candidate.candidateId);
      checkbox.setAttribute("aria-label", `Select candidate ${candidate.number}`);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => toggleCandidate(candidate.candidateId, checkbox.checked));

      const number = document.createElement("div");
      number.className = "candidate-number";
      number.textContent = String(candidate.number);

      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "candidate-title";
      title.textContent = titleFor(candidate);

      const address = document.createElement("div");
      address.className = "candidate-address";
      address.textContent = addressFor(candidate) || "No address found";

      body.append(title, address);
      if (candidate.geocodeFailed) {
        const note = document.createElement("div");
        note.className = "candidate-note";
        note.textContent = "Could not place this address on the map.";
        body.appendChild(note);
      }

      item.append(checkbox, number, body);
      els.list.appendChild(item);
    }
    updateSelectionCount();
  }

  function offsetDuplicateCoordinates() {
    const buckets = new Map();
    for (const candidate of state.candidates) {
      if (candidate.lat == null || candidate.lon == null) continue;
      const key = `${candidate.lat.toFixed(6)},${candidate.lon.toFixed(6)}`;
      const bucket = buckets.get(key) || [];
      bucket.push(candidate);
      buckets.set(key, bucket);
    }

    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      bucket.forEach((candidate, index) => {
        const angle = ((index / bucket.length) * Math.PI * 2) - (Math.PI / 2);
        const radius = Math.min(96, 20 + bucket.length * 5);
        candidate.offsetX = Math.cos(angle) * radius;
        candidate.offsetY = Math.sin(angle) * radius;
      });
    }
  }

  function selectCandidate(number) {
    state.activeCandidateNumber = number;
    const candidate = state.candidates.find((item) => item.number === number);
    if (candidate && candidate.lat != null && candidate.lon != null) {
      state.center = { lat: candidate.lat, lon: candidate.lon };
    }
    renderMap();
    renderList();
    document.getElementById(`candidate-${number}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function fitBounds() {
    const placed = state.candidates.filter((candidate) => candidate.lat != null && candidate.lon != null);
    if (!placed.length) {
      state.center = DEFAULT_CENTER;
      state.zoom = 13;
      renderMap();
      return;
    }

    const lats = placed.map((candidate) => candidate.lat);
    const lons = placed.map((candidate) => candidate.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    state.center = {
      lat: (minLat + maxLat) / 2,
      lon: (minLon + maxLon) / 2
    };

    const rect = els.map.getBoundingClientRect();
    for (let zoom = 16; zoom >= 3; zoom -= 1) {
      const topLeft = project(maxLat, minLon, zoom);
      const bottomRight = project(minLat, maxLon, zoom);
      if (Math.abs(bottomRight.x - topLeft.x) <= rect.width - 80 && Math.abs(bottomRight.y - topLeft.y) <= rect.height - 80) {
        state.zoom = zoom;
        renderMap();
        return;
      }
    }

    state.zoom = 3;
    renderMap();
  }

  async function geocode(candidate) {
    const lat = asNumber(candidate.lat || candidate.latitude);
    const lon = asNumber(candidate.lon || candidate.lng || candidate.longitude);
    if (lat != null && lon != null) return Object.assign(candidate, { lat, lon });

    const address = addressFor(candidate);
    if (!address) return Object.assign(candidate, { geocodeFailed: true });
    const query = streetQueryFromAddress(address, state.localityHint);

    const first = await searchAddress(query);
    const foundLat = first ? asNumber(first.lat) : null;
    const foundLon = first ? asNumber(first.lon) : null;
    if (foundLat == null || foundLon == null) return Object.assign(candidate, { geocodeFailed: true });
    return Object.assign(candidate, { lat: foundLat, lon: foundLon });
  }

  async function loadCandidates() {
    const result = await chrome.storage.local.get(["mapCandidates", "mapSelectedCandidateIds", "mapSourceTabId", "mapCanUseDetails"]);
    const candidates = Array.isArray(result.mapCandidates) ? result.mapCandidates : [];
    state.candidates = candidates.map((candidate, index) => Object.assign({}, candidate, { number: candidate.displayNumber || index + 1 }));
    const initialSelection = Array.isArray(result.mapSelectedCandidateIds) ? result.mapSelectedCandidateIds : state.candidates.map((candidate) => candidate.candidateId);
    state.selectedIds = new Set(initialSelection.filter((id) => state.candidates.some((candidate) => candidate.candidateId === id)));
    state.sourceTabId = result.mapSourceTabId || null;
    state.canUseDetails = Boolean(result.mapCanUseDetails);
    state.localityHint = inferLocality();
  }

  async function geocodeAll() {
    let placed = 0;
    for (let index = 0; index < state.candidates.length; index += 1) {
      const candidate = state.candidates[index];
      setStatus(`Placing ${index + 1}/${state.candidates.length}: ${streetQueryFromAddress(addressFor(candidate), state.localityHint) || titleFor(candidate)}`);
      await geocode(candidate);
      if (candidate.lat != null && candidate.lon != null) placed += 1;
      renderList();
      offsetDuplicateCoordinates();
      fitBounds();
      if (index < state.candidates.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
    }
    setStatus(`Placed ${placed}/${state.candidates.length} candidates.`);
  }

  function zoomBy(delta) {
    state.zoom = Math.min(18, Math.max(3, state.zoom + delta));
    renderMap();
  }

  function wireInteractions() {
    els.extractBtn.addEventListener("click", () => extractSelected("basic"));
    els.detailBtn.addEventListener("click", () => extractSelected("details"));
    els.saveBtn.addEventListener("click", saveRows);
    els.showSavedBtn.addEventListener("click", showSavedRows);
    els.copyBtn.addEventListener("click", copyRows);
    els.jsonBtn.addEventListener("click", copyJson);
    els.clearBtn.addEventListener("click", clearSavedRows);
    els.selectAllBtn.addEventListener("click", async () => {
      state.selectedIds = new Set(state.candidates.map((candidate) => candidate.candidateId));
      state.rows = [];
      renderRows();
      await persistSelection();
      renderMap();
      renderList();
    });
    els.selectNoneBtn.addEventListener("click", async () => {
      state.selectedIds = new Set();
      state.rows = [];
      renderRows();
      await persistSelection();
      renderMap();
      renderList();
    });
    els.fitBtn.addEventListener("click", fitBounds);
    els.zoomInBtn.addEventListener("click", () => zoomBy(1));
    els.zoomOutBtn.addEventListener("click", () => zoomBy(-1));
    window.addEventListener("resize", renderMap);

    els.map.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".marker, .map-info, .attribution")) return;
      els.map.setPointerCapture(event.pointerId);
      state.isDragging = true;
      state.dragStart = { x: event.clientX, y: event.clientY };
      state.dragCenter = project(state.center.lat, state.center.lon, state.zoom);
      els.map.classList.add("dragging");
    });

    els.map.addEventListener("pointermove", (event) => {
      if (!state.isDragging) return;
      const next = unproject(
        state.dragCenter.x - (event.clientX - state.dragStart.x),
        state.dragCenter.y - (event.clientY - state.dragStart.y),
        state.zoom
      );
      state.center = next;
      renderMap();
    });

    els.map.addEventListener("pointerup", () => {
      state.isDragging = false;
      els.map.classList.remove("dragging");
    });

    els.map.addEventListener("click", (event) => {
      if (event.target.closest(".marker, .map-info, .attribution")) return;
      state.activeCandidateNumber = null;
      renderMap();
      renderList();
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    wireInteractions();
    await refreshSavedCount();
    await loadCandidates();
    renderList();
    renderMap();
    renderRows();
    setBusy(false);
    if (!state.candidates.length) {
      setStatus("No candidates were sent to the map.", true);
      return;
    }
    await geocodeAll();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "EXTRACT_PROGRESS") return;
    const total = message.total || 0;
    const current = message.current || 0;
    setStatus(`Details ${current}/${total}: ${message.label || message.url || ""}`);
  });
})();
