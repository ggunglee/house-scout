(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const RC = root.RentalCompare = root.RentalCompare || {};

  const CSV_COLUMNS = [
    "site",
    "name",
    "title",
    "address",
    "unitSize",
    "rent",
    "rentText",
    "sqft",
    "fromJackson",
    "fromPWG",
    "utilitiesIncluded",
    "laundry",
    "amenities",
    "appliances",
    "applicationFee",
    "phone",
    "url"
  ];

  const SHEET_COLUMNS = [
    { key: "name", label: "이름" },
    { key: "area", label: "면적" },
    { key: "rent", label: "월세" },
    { key: "utilities", label: "유틸리티 포함(전기 제외)" },
    { key: "laundry", label: "세탁기" },
    { key: "fromJackson", label: "잭슨 거리" },
    { key: "features", label: "특징" }
  ];

  function csvEscape(value) {
    if (Array.isArray(value)) value = value.join("; ");
    if (value == null) value = "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function rowsToCsv(rows) {
    const lines = [CSV_COLUMNS.join(",")];
    const outputRows = normalizeRowsForOutput(rows);
    for (const row of outputRows) {
      lines.push(CSV_COLUMNS.map((column) => csvEscape(row[column])).join(","));
    }
    return lines.join("\r\n");
  }

  function compact(value) {
    if (Array.isArray(value)) return value.map(compact).filter(Boolean).join("; ");
    if (value == null) return "";
    return String(value).replace(/\s+/g, " ").trim();
  }

  function numberText(value) {
    if (value == null || value === "") return "";
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.round(number)) : compact(value);
  }

  function rentText(row) {
    const source = compact(row.rentText || row.rent);
    if (!source) return "";
    const matches = source.match(/[0-9][0-9,]*/g);
    if (!matches || matches.length === 0) return source.replace(/\$/g, "");
    return matches.map((match) => match.replace(/,/g, "")).join(source.includes("-") ? "-" : ", ");
  }

  function areaText(row) {
    const direct = numberText(row.sqft || row.area || row.squareFeet);
    if (direct) return direct;
    const source = compact([row.unitSize, row.description, row.amenities].filter(Boolean).join(" "));
    const match = source.match(/([0-9][0-9,]*)\s*(?:sq\.?\s*ft\.?|sqft|square feet)/i);
    return match ? match[1].replace(/,/g, "") : "";
  }

  function utilitiesText(row) {
    const source = compact([
      row.utilitiesIncluded,
      row.utilities,
      row.description,
      row.amenities
    ].filter(Boolean).join(" ")).toLowerCase();
    if (!source) return "?";
    if (/not included|not include|tenant pays|resident pays|separate|excluded|responsible for utilities|utilities extra/.test(source)) {
      if (/electric|electricity/.test(source) && /except|excluding|not include|separate/.test(source) && /heat|hot water|water|gas|internet|wifi|trash|sewer/.test(source)) {
        return "O";
      }
      return "미포함";
    }
    if (/included|include|utilities paid|heat and hot water|hot water|water|trash|sewer|internet|wifi/.test(source)) return "O";
    return "?";
  }

  function laundryStatus(row) {
    const source = compact([
      row.laundry,
      row.amenities,
      row.appliances,
      row.description
    ].filter(Boolean).join(" ")).toLowerCase();
    if (/no laundry|laundry not available|no washer|no dryer/.test(source)) return null;
    if (/in[-\s]?unit|in unit|washer.?dryer|washer and dryer|w\/d|laundry in unit/.test(source)) return "O";
    if (/laundry|washer|dryer/.test(source) && /shared|common|community|on[-\s]?site|onsite|coin|card|laundry room|building|basement/.test(source)) return "X";
    if (/laundry|washer|dryer/.test(source)) return "?";
    return "";
  }

  function featuresText(row) {
    return [row.amenities, row.appliances, row.parking, row.pets]
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map(compact)
      .filter(Boolean)
      .join("; ");
  }

  function jacksonText(row) {
    const value = compact(row.fromJackson);
    if (value) return value.replace(/\s*\bmins?\b/i, "분").replace(/\s*\bhr\b/i, "시간");
    return "";
  }

  function formatSheetRow(row) {
    const laundry = laundryStatus(row);
    if (laundry == null) return null;
    return {
      name: compact(row.name || row.title || row.address),
      area: areaText(row),
      rent: rentText(row),
      utilities: utilitiesText(row),
      laundry,
      fromJackson: jacksonText(row),
      features: featuresText(row)
    };
  }

  function rowsToSheetRows(rows) {
    return normalizeRowsForOutput(rows)
      .map(formatSheetRow)
      .filter(Boolean);
  }

  function tsvEscape(value) {
    return compact(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
  }

  function rowsToTsv(rows) {
    const sheetRows = rowsToSheetRows(rows);
    const lines = [SHEET_COLUMNS.map((column) => column.label).join("\t")];
    for (const row of sheetRows) {
      lines.push(SHEET_COLUMNS.map((column) => tsvEscape(row[column.key])).join("\t"));
    }
    return lines.join("\n");
  }

  function normalizeRowsForOutput(rows) {
    return (rows || []).map((row) => {
      const output = Object.assign({}, row);
      output.url = row.detailUrl || row.pageUrl || "";
      return output;
    });
  }

  function downloadCsv(rows, filename) {
    const csv = rowsToCsv(rows);
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  Object.assign(RC, {
    CSV_COLUMNS,
    SHEET_COLUMNS,
    normalizeRowsForOutput,
    rowsToCsv,
    rowsToSheetRows,
    rowsToTsv,
    downloadCsv
  });
})();
