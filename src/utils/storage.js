(function () {
  "use strict";

  const RC = window.RentalCompare = window.RentalCompare || {};
  const STORAGE_KEY = "rentalRows";

  function dedupeKey(row) {
    if (RC.rowDedupeKey) return RC.rowDedupeKey(row);
    return [row && row.site, row && row.detailUrl, row && row.address, row && row.unitSize, row && row.rent]
      .map((value) => value == null ? "" : String(value).trim().toLowerCase())
      .join("|");
  }

  async function getSavedRows() {
    const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
    const rows = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    const deduped = RC.dedupeRows ? RC.dedupeRows(rows) : rows;
    if (deduped.length !== rows.length) {
      await chrome.storage.local.set({ [STORAGE_KEY]: deduped });
    }
    return deduped;
  }

  async function saveRows(rows) {
    const existing = await getSavedRows();
    const merged = RC.dedupeRows ? RC.dedupeRows(existing.concat(rows || [])) : Array.from(new Map(existing.concat(rows || []).map((row) => [dedupeKey(row), row])).values());
    await chrome.storage.local.set({ [STORAGE_KEY]: merged });
    return merged;
  }

  async function clearSavedRows() {
    await chrome.storage.local.remove(STORAGE_KEY);
    return [];
  }

  Object.assign(RC, { STORAGE_KEY, dedupeKey, getSavedRows, saveRows, clearSavedRows });
})();
