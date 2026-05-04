(function () {
  "use strict";

  const RC = window.RentalCompare = window.RentalCompare || {};

  function cleanText(text) {
    if (text == null) return null;
    const value = String(text).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    return value || null;
  }

  function moneyToNumber(text) {
    const value = cleanText(text);
    if (!value) return null;
    const match = value.match(/\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  function parseBedBath(text) {
    const value = cleanText(text) || "";
    const lower = value.toLowerCase();
    let beds = null;
    let baths = null;

    if (/\bstudio\b/.test(lower)) beds = "Studio";

    const bedMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:bd|bds|bed|beds|bedroom|bedrooms)\b/);
    if (bedMatch) beds = Number(bedMatch[1]);

    const bathMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:ba|bas|bath|baths|bathroom|bathrooms)\b/);
    if (bathMatch) baths = Number(bathMatch[1]);

    const slashMatch = lower.match(/(\d+(?:\.\d+)?|studio)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (slashMatch) {
      beds = slashMatch[1] === "studio" ? "Studio" : Number(slashMatch[1]);
      baths = Number(slashMatch[2]);
    }

    return { beds, baths };
  }

  function parseSqft(text) {
    const value = cleanText(text);
    if (!value) return null;
    const match = value.match(/([0-9][0-9,]*)\s*(?:sq\.?\s*ft\.?|sqft|square feet)/i) || value.match(/^([0-9][0-9,]*)$/);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  function unitSizeFromBeds(beds) {
    if (beds == null || beds === "") return null;
    if (String(beds).toLowerCase() === "studio") return "Studio";
    const number = Number(beds);
    if (!Number.isFinite(number)) return cleanText(beds);
    if (number === 0) return "Studio";
    return number === 1 ? "1 Bedroom" : `${number} Bedrooms`;
  }

  function normalizeUnitSize(row) {
    if (!row) return row;
    const normalized = Object.assign({}, row);
    normalized.unitSize = cleanText(normalized.unitSize) || unitSizeFromBeds(normalized.beds);
    return normalized;
  }

  function normalizeRowsForOutput(rows) {
    return (rows || []).map((row) => {
      const normalized = normalizeUnitSize(row);
      const output = Object.assign({}, normalized);
      delete output.beds;
      delete output.baths;
      return output;
    });
  }

  function absolutizeUrl(url, baseUrl) {
    const value = cleanText(url);
    if (!value) return null;
    try {
      return new URL(value, baseUrl || location.href).href;
    } catch (_error) {
      return null;
    }
  }

  function uniqueArray(arr) {
    return Array.from(new Set((arr || []).map(cleanText).filter(Boolean)));
  }

  function safeJsonParse(str) {
    try {
      return JSON.parse(str);
    } catch (_error) {
      return null;
    }
  }

  function extractJsonLd(doc) {
    return Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
      .flatMap((script) => {
        const parsed = safeJsonParse(script.textContent);
        if (!parsed) return [];
        if (Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed["@graph"])) return parsed["@graph"];
        return [parsed];
      });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function textFromSelectors(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const text = cleanText(node && (node.getAttribute("content") || node.textContent));
      if (text) return text;
    }
    return null;
  }

  function attrFromSelectors(root, selectors, attr) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const value = cleanText(node && node.getAttribute(attr));
      if (value) return value;
    }
    return null;
  }

  function makeRow(overrides) {
    const now = new Date().toISOString();
    return normalizeUnitSize(Object.assign({
      id: null,
      site: "Unknown",
      sourceType: "generic",
      name: null,
      title: null,
      address: null,
      unitSize: null,
      rent: null,
      rentText: null,
      minRent: null,
      maxRent: null,
      beds: null,
      baths: null,
      sqft: null,
      available: null,
      utilitiesIncluded: null,
      laundry: null,
      parking: null,
      pets: null,
      amenities: [],
      appliances: null,
      description: null,
      imageUrl: null,
      detailUrl: null,
      pageUrl: location.href,
      latitude: null,
      longitude: null,
      phone: null,
      applicationFee: null,
      raw: null,
      capturedAt: now
    }, overrides || {}));
  }

  function parseAddressObject(address) {
    if (!address) return null;
    if (typeof address === "string") return cleanText(address);
    return cleanText([
      address.streetAddress,
      address.addressLocality,
      address.addressRegion,
      address.postalCode
    ].filter(Boolean).join(", "));
  }

  function extractLabelValueFromText(text, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escaped}\\s*:?\\s*([^\\n]+)`, "i");
    const match = String(text || "").match(regex);
    return cleanText(match && match[1]);
  }

  function normalizeKeyPart(value) {
    return cleanText(value)
      ? cleanText(value).toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ")
      : "";
  }

  function normalizeUrlForKey(url) {
    const value = cleanText(url);
    if (!value) return "";
    try {
      const parsed = new URL(value, location.href);
      parsed.hash = "";
      parsed.searchParams.delete("utm_source");
      parsed.searchParams.delete("utm_medium");
      parsed.searchParams.delete("utm_campaign");
      return parsed.href.replace(/\/$/, "").toLowerCase();
    } catch (_error) {
      return value.replace(/#.*$/, "").replace(/\/$/, "").toLowerCase();
    }
  }

  function rowDedupeKey(row) {
    if (!row) return "";
    const rent = row.rent != null && row.rent !== "" ? row.rent : moneyToNumber(row.rentText);
    const identityParts = [
      normalizeKeyPart(row.site),
      normalizeUrlForKey(row.detailUrl || row.pageUrl),
      normalizeKeyPart(row.address),
      normalizeKeyPart(row.unitSize || row.unit || row.floorPlan),
      normalizeKeyPart(rent),
      normalizeKeyPart(row.beds),
      normalizeKeyPart(row.baths),
      normalizeKeyPart(row.sqft)
    ];
    if (!identityParts.slice(1).some(Boolean)) {
      return [identityParts[0], normalizeKeyPart(row.candidateLabel || row.title || row.name || row.description)].filter(Boolean).join("|");
    }
    const key = identityParts.join("|");
    return key.replace(/\|+$/g, "") || normalizeKeyPart(row.candidateLabel || row.title || row.name);
  }

  function rowScore(row) {
    return [
      row && row.detailUrl,
      row && row.address,
      row && row.unitSize,
      row && (row.rent || row.rentText),
      row && row.beds,
      row && row.baths,
      row && row.sqft,
      row && row.available,
      row && row.description,
      row && row.imageUrl
    ].filter(Boolean).length;
  }

  function mergeDuplicateRows(existing, incoming) {
    const preferred = rowScore(incoming) > rowScore(existing) ? incoming : existing;
    const fallback = preferred === incoming ? existing : incoming;
    return Object.assign({}, fallback, preferred, {
      amenities: uniqueArray([].concat(fallback.amenities || [], preferred.amenities || [])),
      raw: preferred.raw || fallback.raw
    });
  }

  function dedupeRows(rows) {
    const map = new Map();
    for (const row of rows || []) {
      const key = rowDedupeKey(row);
      if (!key) continue;
      map.set(key, map.has(key) ? mergeDuplicateRows(map.get(key), row) : row);
    }
    return Array.from(map.values());
  }

  Object.assign(RC, {
    cleanText,
    moneyToNumber,
    parseBedBath,
    parseSqft,
    unitSizeFromBeds,
    normalizeUnitSize,
    normalizeRowsForOutput,
    absolutizeUrl,
    uniqueArray,
    safeJsonParse,
    extractJsonLd,
    sleep,
    textFromSelectors,
    attrFromSelectors,
    makeRow,
    parseAddressObject,
    extractLabelValueFromText,
    rowDedupeKey,
    dedupeRows
  });
})();
