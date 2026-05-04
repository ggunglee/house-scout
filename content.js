(function () {
  "use strict";

  const RC = window.RentalCompare = window.RentalCompare || {};

  function detectSite() {
    const hostname = location.hostname.toLowerCase();
    if (hostname.includes("zillow.com")) return "zillow";
    if (hostname.includes("apartments.com")) return "apartments";
    if (hostname.includes("trumbullenterprises.com")) return "hadley";
    if (hostname.includes("eastrockrealestate.com") || findAppfolioListingUrl()) return "eastRock";
    if (hostname.includes("appfolio.com") || hostname.includes("appf.io")) return "eastRock";
    if (document.querySelector(".js-listings-container, .js-listing-item")) return "eastRock";
    return "generic";
  }

  function findAppfolioListingUrl() {
    const iframe = document.querySelector('iframe[src*="appfolio.com/listings"], iframe[src*="appf.io/listings"]');
    if (iframe && iframe.src) return iframe.src;

    const scripts = Array.from(document.scripts).map((script) => script.textContent || "").join("\n");
    const hostMatch = scripts.match(/hostUrl:\s*['"]([^'"]+)['"]/i);
    if (!hostMatch) return null;

    const orderMatch = scripts.match(/defaultOrder:\s*['"]([^'"]+)['"]/i);
    const url = new URL(`https://${hostMatch[1].replace(/^https?:\/\//, "")}/listings`);
    url.searchParams.set(String(Date.now()), "");
    if (orderMatch) url.searchParams.set("filters[order_by]", orderMatch[1]);
    return url.href;
  }

  function isHadleyDetailCapable() {
    const site = detectSite();
    return (site === "hadley" && location.pathname.includes("/search-apartments/")) || site === "zillow";
  }

  function addCandidateFields(rows, prefix) {
    return (rows || []).map((row, index) => {
      const key = RC.rowDedupeKey ? RC.rowDedupeKey(row) : (row.candidateId || row.id || `${prefix}-${index + 1}`);
      return Object.assign({}, row, {
      candidateId: `${prefix}:${key || index + 1}`,
      candidateLabel: row.candidateLabel || [row.title || row.name, row.unitSize, row.address, row.rentText, row.available].filter(Boolean).join(" | "),
      candidateType: row.candidateType || row.sourceType || "row"
      });
    });
  }

  function dedupeRows(rows) {
    return RC.dedupeRows ? RC.dedupeRows(rows) : (rows || []);
  }

  function prepareCandidates(rows, prefix) {
    return dedupeRows(addCandidateFields(rows, prefix));
  }

  async function sendProgress(progress) {
    try {
      const result = chrome.runtime.sendMessage(Object.assign({ type: "EXTRACT_PROGRESS" }, progress));
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch (_error) {}
  }

  async function extractRows(mode) {
    const site = detectSite();
    if (site === "zillow") return { site, rows: dedupeRows(RC.extractZillow(document)), warnings: [] };
    if (site === "apartments") return { site, rows: dedupeRows(RC.extractApartmentsCom(document)), warnings: [] };
    if (site === "eastRock") {
      const rows = dedupeRows(RC.extractEastRockListings(document));
      const embeddedUrl = rows.length ? null : findAppfolioListingUrl();
      return { site, rows, warnings: embeddedUrl ? [`APPFOLIO_URL:${embeddedUrl}`] : [] };
    }
    if (site === "hadley") {
      if (mode === "details") {
        const rows = await RC.extractHadleyListingsWithDetails(document, sendProgress);
        return { site, rows: dedupeRows(rows), warnings: [] };
      }
      return { site, rows: dedupeRows(RC.extractHadleyBasic(document)), warnings: [] };
    }
    return { site, rows: dedupeRows(RC.extractGeneric(document)), warnings: [] };
  }

  async function extractCandidates() {
    const site = detectSite();
    if (site === "apartments") return { site, candidates: prepareCandidates(RC.extractApartmentsCandidates(document), "apartments"), warnings: [] };
    if (site === "zillow") return { site, candidates: prepareCandidates(RC.extractZillowCandidates(document), "zillow"), warnings: [] };
    if (site === "hadley") return { site, candidates: prepareCandidates(RC.extractHadleyCandidates(document), "hadley"), warnings: [] };
    if (site === "eastRock") {
      const candidates = prepareCandidates(RC.extractEastRockCandidates(document), "east-rock");
      const embeddedUrl = candidates.length ? null : findAppfolioListingUrl();
      return { site, candidates, warnings: embeddedUrl ? [`APPFOLIO_URL:${embeddedUrl}`] : [] };
    }
    return { site, candidates: prepareCandidates(RC.extractGeneric(document), "generic"), warnings: [] };
  }

  async function extractSelected(candidateIds, mode) {
    const site = detectSite();
    const wanted = new Set(candidateIds || []);
    if (!wanted.size) return { site, rows: [], warnings: [] };

    if (site === "zillow" && mode === "details") {
      const candidates = (await extractCandidates()).candidates.filter((row) => wanted.has(row.candidateId));
      const rows = await RC.extractZillowDetailsForCandidates(candidates, sendProgress);
      return { site, rows: dedupeRows(rows), warnings: [] };
    }

    if (site === "hadley" && mode === "details") {
      const candidates = (await extractCandidates()).candidates.filter((row) => wanted.has(row.candidateId));
      const cards = candidates.map((candidate) => candidate.raw && candidate.raw.card).filter(Boolean);
      const rows = await RC.extractHadleyListingsWithDetailsForCards(cards, sendProgress);
      return { site, rows: dedupeRows(rows), warnings: [] };
    }

    const result = await extractCandidates();
    const rows = dedupeRows(result.candidates.filter((row) => wanted.has(row.candidateId)));
    return { site, rows, warnings: result.warnings || [] };
  }

  RC.detectSite = detectSite;
  RC.handleRentalCompareMessage = async function (message) {
    if (!message || !message.type) return null;
    if (message.type === "PING") {
      return { ok: true, site: detectSite(), canUseDetails: isHadleyDetailCapable(), appfolioListingUrl: findAppfolioListingUrl() };
    }
    if (message.type === "EXTRACT") return Object.assign({ ok: true }, await extractRows(message.mode || "basic"));
    if (message.type === "GET_CANDIDATES") return Object.assign({ ok: true }, await extractCandidates());
    if (message.type === "EXTRACT_SELECTED") return Object.assign({ ok: true }, await extractSelected(message.candidateIds || [], message.mode || "basic"));
    return null;
  };

  if (!RC.messageListenerInstalled) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      Promise.resolve(RC.handleRentalCompareMessage(message))
        .then((response) => {
          if (response) sendResponse(response);
        })
        .catch((error) => sendResponse({
          ok: false,
          error: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : null
        }));
      return true;
    });
    RC.messageListenerInstalled = true;
  }
})();
