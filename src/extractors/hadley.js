(function () {
  "use strict";

  const RC = window.RentalCompare = window.RentalCompare || {};

  function findHadleyCards(doc) {
    const columnCards = Array.from(doc.querySelectorAll(".columnwrap .column3, .column3"))
      .filter((card) => card.querySelector('a[href*="/property/"]') && card.querySelector(".listing-info") && card.querySelector("h3"));
    if (columnCards.length) return columnCards;

    return Array.from(doc.querySelectorAll('a[href*="/property/"]'))
      .map((link) => link.closest(".column3"))
      .filter((card, index, arr) => card && arr.indexOf(card) === index);
  }

  function cardToData(card, index) {
    const link = card.querySelector('.button a[href*="/property/"]') || card.querySelector('.featuredimg a[href*="/property/"]') || card.querySelector('a[href*="/property/"]');
    const image = card.querySelector(".featuredimg img") || card.querySelector("img");
    const name = RC.textFromSelectors(card, ["h3", "h2", ".title", ".property-title"]) || RC.cleanText(link && link.textContent);
    const area = RC.textFromSelectors(card, [".areatext"]);
    const infoClone = card.querySelector(".listing-info") && card.querySelector(".listing-info").cloneNode(true);
    if (infoClone) {
      Array.from(infoClone.querySelectorAll("h1,h2,h3,.areatext,.aptfeatures,.button")).forEach((node) => node.remove());
    }
    const address = RC.cleanText(infoClone && infoClone.textContent) || RC.textFromSelectors(card, [".address"]);
    const features = Array.from(card.querySelectorAll(".aptfeatures p"))
      .map((node) => RC.cleanText(node.textContent))
      .filter((text) => text && !/^apartment features$/i.test(text))
      .join("; ") || RC.textFromSelectors(card, [".aptfeatures", ".features"]);
    const detailUrl = RC.absolutizeUrl(link && link.getAttribute("href"));
    const imageUrl = RC.absolutizeUrl(image && (image.getAttribute("data-src") || image.getAttribute("src")));

    return {
      id: detailUrl || `hadley-card-${index + 1}`,
      name,
      area,
      address,
      features,
      detailUrl,
      imageUrl,
      rawText: RC.cleanText(card.innerText || card.textContent)
    };
  }

  function extractHadleyCardsFromListPage(doc) {
    return findHadleyCards(doc).map(cardToData).filter((card) => card.name || card.address || card.detailUrl);
  }

  function hadleyCardToRow(card) {
    const classified = classifyHadleyFeatures(card.area, card.features);
    return RC.makeRow({
      id: card.id,
      site: "Hadley/Trumbull",
      sourceType: "list-page",
      name: card.name,
      title: card.name,
      address: card.address,
      laundry: classified.laundry,
      amenities: RC.uniqueArray([card.area, classified.amenities]),
      appliances: classified.appliances,
      description: card.features,
      imageUrl: card.imageUrl,
      detailUrl: card.detailUrl,
      raw: { area: card.area, features: card.features }
    });
  }

  function cleanHadleyTitle(title) {
    const value = RC.cleanText(title);
    if (!value || /^hadley\s+inc\b/i.test(value)) return null;
    return RC.cleanText(value.replace(/\s*\|\s*Hadley\s+Inc\s*$/i, ""));
  }

  function cleanHadleyRentText(text) {
    const value = RC.cleanText(String(text || "").replace(/^starting\s+at\s*/i, ""));
    const match = value && value.match(/\$?\s*[0-9][0-9,]*(?:\s*[-\u2013\u2014]\s*\$?\s*[0-9][0-9,]*)?/);
    if (!match) return value;
    return match[0]
      .split(/[-\u2013\u2014]/)
      .map((part) => {
        const number = RC.cleanText(part).replace(/^\$?\s*/, "");
        return number ? `$${number}` : null;
      })
      .filter(Boolean)
      .join(" - ");
  }

  function extractHadleyUtilities(text, features) {
    const sources = [text, features].map((value) => RC.cleanText(value)).filter(Boolean);
    for (const source of sources) {
      const rentIncludes = source.match(/(?:rent\s+includes|rent\s+included)\s+(.+?)(?=\s+(?:finished|on-site|walk to|on the|in a|convenient|1 month|24-hour|studio\b|\d+\s+bedroom)|[.;\n]|$)/i);
      if (rentIncludes) return RC.cleanText(rentIncludes[1]);

      const labeled = RC.extractLabelValueFromText(source, "Utilities Included") ||
        RC.extractLabelValueFromText(source, "Included Utilities");
      if (labeled) return labeled;

      const includedInRent = source.match(/(?:includes?|included)\s+(?:the\s+)?(?:cost\s+of\s+)?(.+?)\s+(?:in|with)\s+(?:the\s+)?rent/i) ||
        source.match(/(.+?)\s+(?:is|are)\s+included\s+(?:in|with)\s+(?:the\s+)?rent/i);
      if (includedInRent) return RC.cleanText(includedInRent[1]);
    }

    return null;
  }

  function featureParts() {
    return Array.from(arguments)
      .map((value) => RC.cleanText(value))
      .filter(Boolean)
      .flatMap((value) => value.split(/[;\n]/))
      .map((value) => RC.cleanText(value))
      .filter((value) => value && !/^apartment features$/i.test(value));
  }

  function classifyHadleyFeatures() {
    const parts = featureParts.apply(null, arguments);
    const appliances = [];
    const amenities = [];
    let laundry = null;

    for (const part of parts) {
      if (/laundry|washer|dryer/i.test(part)) {
        laundry = laundry || part;
        continue;
      }

      if (/\b(a\/c|ac|air conditioning|central air|electric stove|gas stove|stove|range|oven|refrigerator|fridge|dishwasher|microwave|hardwood|hard wood|hard-wood|floor)\b/i.test(part)) {
        appliances.push(part);
        continue;
      }

      if (/\b(media room|exercise room|fitness|gym|community room|common room|lounge|pool|courtyard|roof|rooftop|shuttle|parking|bike|storage|elevator|doorman|yard|patio|balcony)\b/i.test(part)) {
        amenities.push(part);
      }
    }

    return {
      laundry,
      appliances: RC.uniqueArray(appliances).join("; ") || null,
      amenities: RC.uniqueArray(amenities).join("; ") || null
    };
  }

  function extractHadleyBasic(doc) {
    const cards = extractHadleyCardsFromListPage(doc);
    if (cards.length) return cards.map(hadleyCardToRow);

    if (location.pathname.includes("/property/")) {
      const parsed = parseHadleyDetailPage(doc);
      const classified = classifyHadleyFeatures(parsed.detailFeatures);
      const heading = RC.textFromSelectors(doc, ["article header + section h1", "article section h1", "h1"]);
      const name = cleanHadleyTitle(heading) || parsed.detailTitle;
      const addressNode = doc.querySelector("article section > p");
      const addressBlock = RC.cleanText(addressNode && (addressNode.innerText || addressNode.textContent));
      const imageUrl = RC.absolutizeUrl(RC.attrFromSelectors(doc, ["#feat", "article img", "meta[property='og:image']"], "src") || RC.attrFromSelectors(doc, ["meta[property='og:image']"], "content"));
      const base = {
        site: "Hadley/Trumbull",
        sourceType: "detail-page",
        name,
        title: name,
        address: addressBlock,
        utilitiesIncluded: parsed.utilitiesIncluded,
        laundry: classified.laundry,
        amenities: RC.uniqueArray([classified.amenities]),
        appliances: classified.appliances,
        description: parsed.detailFeatures,
        imageUrl,
        detailUrl: location.href,
        applicationFee: parsed.applicationFee,
        raw: { detail: parsed }
      };

      if (parsed.rentRows.length) {
        return parsed.rentRows.map((rentRow, index) => RC.makeRow(Object.assign({}, base, {
          id: `${location.href}#${index + 1}`,
          unitSize: rentRow.unitSize,
          rent: rentRow.rent,
          rentText: rentRow.rentText
        })));
      }

      return [RC.makeRow(base)];
    }

    return [];
  }

  function parseHadleyDetailPage(doc) {
    const detailTitle = cleanHadleyTitle(RC.textFromSelectors(doc, ["h1", "h2", "title"]));
    const allText = RC.cleanText(doc.body && doc.body.innerText) || "";
    const rentRows = [];
    let applicationFee = null;

    function addRentRow(unitCell, rentCell) {
      const unitSize = RC.cleanText(String(unitCell || "").replace(/unit size\*?/i, ""));
      const rentText = cleanHadleyRentText(rentCell);
      const rent = RC.moneyToNumber(rentText);
      if (unitSize && !/application fee/i.test(unitSize) && (rent || /studio|bedroom/i.test(unitSize))) {
        rentRows.push({ unitSize, rentText, rent });
      }
    }

    doc.querySelectorAll("tr").forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("th,td")).map((cell) => RC.cleanText(cell.textContent)).filter(Boolean);
      if (cells.length < 2) return;
      const rowText = cells.join(" ");
      if (/application fee/i.test(rowText)) {
        applicationFee = RC.moneyToNumber(rowText);
        return;
      }
      if (/\$|starting at|studio|bedroom/i.test(rowText)) {
        const unitCell = cells.find((cell) => /studio|bedroom|bedrooms|unit size/i.test(cell)) || cells[0];
        const rentCell = cells.find((cell) => /\$|starting at/i.test(cell)) || cells[1];
        addRentRow(unitCell, rentCell);
      }
    });

    doc.querySelectorAll(".grid.table").forEach((table) => {
      const cells = Array.from(table.children).map((cell) => RC.cleanText(cell.textContent)).filter(Boolean);
      for (let index = 0; index < cells.length - 1; index += 2) {
        const left = cells[index];
        const right = cells[index + 1];
        const pairText = `${left} ${right}`;
        if (/unit size|monthly rental/i.test(pairText)) continue;
        if (/application fee/i.test(left)) {
          applicationFee = RC.moneyToNumber(right);
        } else if (/\$|starting at|studio|bedroom/i.test(pairText)) {
          addRentRow(left, right);
        }
      }
    });

    if (applicationFee == null) {
      const feeMatch = allText.match(/Application Fee\s*:?\s*\$?\s*[0-9][0-9,]*/i);
      applicationFee = feeMatch ? RC.moneyToNumber(feeMatch[0]) : null;
    }

    let detailFeatures = null;
    const featureHeading = Array.from(doc.querySelectorAll("h1,h2,h3,h4,strong,b")).find((node) => /apartment features/i.test(node.textContent || ""));
    if (featureHeading) {
      const nearby = [];
      let node = featureHeading.nextElementSibling;
      while (node && nearby.length < 4 && !/^H[1-4]$/.test(node.tagName)) {
        if (node.matches && node.matches(".grid.table")) break;
        nearby.push(RC.cleanText(node.innerText || node.textContent));
        node = node.nextElementSibling;
      }
      detailFeatures = RC.cleanText(nearby.filter(Boolean).join("; "));
    }

    if (!detailFeatures) {
      const lines = String(doc.body && doc.body.innerText || "")
        .split(/\n+/)
        .map(RC.cleanText)
        .filter(Boolean);
      const start = lines.findIndex((line) => /apartment features/i.test(line));
      if (start >= 0) {
        const nearby = [];
        for (let index = start + 1; index < lines.length && nearby.length < 20; index += 1) {
          const line = lines[index];
          if (/unit size|monthly rental|application fee|contact|schedule|floor plan/i.test(line)) break;
          nearby.push(line);
        }
        detailFeatures = RC.cleanText(nearby.join("; "));
      }
    }

    return {
      detailTitle,
      detailFeatures,
      utilitiesIncluded: extractHadleyUtilities(allText, detailFeatures),
      rentRows,
      applicationFee,
      rawTextSnippet: allText.slice(0, 1200)
    };
  }

  function extractHadleyCandidates(doc) {
    const cards = extractHadleyCardsFromListPage(doc);
    if (!cards.length) {
      return extractHadleyBasic(doc).map((row, index) => Object.assign({}, row, {
        candidateId: row.id || `hadley-detail-${index + 1}`,
        candidateLabel: [row.title || row.name, row.unitSize, row.rentText].filter(Boolean).join(" | "),
        candidateType: "hadley-detail-row"
      }));
    }

    return cards.map((card, index) => Object.assign(hadleyCardToRow(card), {
      candidateId: card.detailUrl || `hadley-${index + 1}`,
      candidateLabel: [card.name, card.address, card.area].filter(Boolean).join(" | "),
      candidateType: "hadley-property-card",
      raw: { card }
    }));
  }

  async function extractHadleyListingsWithDetailsForCards(cards, progressCallback) {
    const total = cards.length;
    const rows = [];

    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      if (progressCallback) progressCallback({ current: index + 1, total, label: card.name || "detail page", url: card.detailUrl });

      if (!card.detailUrl) {
        rows.push(Object.assign(hadleyCardToRow(card), { sourceType: "list+detail", raw: { error: "detail URL not found", card } }));
        continue;
      }

      try {
        const response = await fetch(card.detailUrl, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const detailDoc = new DOMParser().parseFromString(html, "text/html");
        const parsed = parseHadleyDetailPage(detailDoc);
        const classified = classifyHadleyFeatures(card.features, parsed.detailFeatures);
        const imageUrl = card.imageUrl || RC.absolutizeUrl(RC.attrFromSelectors(detailDoc, ["meta[property='og:image']", "img"], "content") || RC.attrFromSelectors(detailDoc, ["img"], "src"), card.detailUrl);
        const base = {
          site: "Hadley/Trumbull",
          sourceType: "list+detail",
          name: card.name || parsed.detailTitle,
          title: card.name || parsed.detailTitle,
          address: card.address,
          utilitiesIncluded: parsed.utilitiesIncluded || extractHadleyUtilities(card.rawText, card.features),
          laundry: classified.laundry,
          amenities: RC.uniqueArray([card.area, classified.amenities]),
          appliances: classified.appliances,
          description: parsed.detailFeatures || card.features,
          imageUrl,
          detailUrl: card.detailUrl,
          pageUrl: location.href,
          applicationFee: parsed.applicationFee
        };

        if (parsed.rentRows.length) {
          parsed.rentRows.forEach((rentRow, rentIndex) => {
            rows.push(RC.makeRow(Object.assign({}, base, {
              id: `${card.detailUrl}#${rentIndex + 1}`,
              unitSize: rentRow.unitSize,
              rent: rentRow.rent,
              rentText: rentRow.rentText,
              raw: { card, detail: parsed }
            })));
          });
        } else {
          rows.push(RC.makeRow(Object.assign({}, base, {
            id: card.detailUrl,
            raw: { card, detail: parsed }
          })));
        }
      } catch (error) {
        rows.push(RC.makeRow(Object.assign({}, hadleyCardToRow(card), {
          sourceType: "list+detail",
          raw: { error: error.message, card }
        })));
      }

      if (index < cards.length - 1) {
        await RC.sleep(500 + Math.floor(Math.random() * 401));
      }
    }

    return rows;
  }

  async function extractHadleyListingsWithDetails(doc, progressCallback) {
    const cards = extractHadleyCardsFromListPage(doc);
    if (cards.length) return extractHadleyListingsWithDetailsForCards(cards, progressCallback);
    const total = cards.length;
    const rows = [];

    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      if (progressCallback) progressCallback({ current: index + 1, total, label: card.name || "상세 페이지", url: card.detailUrl });

      if (!card.detailUrl) {
        rows.push(Object.assign(hadleyCardToRow(card), { sourceType: "list+detail", raw: { error: "상세 URL을 찾지 못했습니다.", card } }));
        continue;
      }

      try {
        const response = await fetch(card.detailUrl, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const detailDoc = new DOMParser().parseFromString(html, "text/html");
        const parsed = parseHadleyDetailPage(detailDoc);
        const classified = classifyHadleyFeatures(card.features, parsed.detailFeatures);
        const imageUrl = card.imageUrl || RC.absolutizeUrl(RC.attrFromSelectors(detailDoc, ["meta[property='og:image']", "img"], "content") || RC.attrFromSelectors(detailDoc, ["img"], "src"), card.detailUrl);
        const base = {
          site: "Hadley/Trumbull",
          sourceType: "list+detail",
          name: card.name || parsed.detailTitle,
          title: card.name || parsed.detailTitle,
          address: card.address,
          utilitiesIncluded: parsed.utilitiesIncluded || extractHadleyUtilities(card.rawText, card.features),
          laundry: classified.laundry,
          amenities: RC.uniqueArray([card.area, classified.amenities]),
          appliances: classified.appliances,
          description: parsed.detailFeatures || card.features,
          imageUrl,
          detailUrl: card.detailUrl,
          pageUrl: location.href,
          applicationFee: parsed.applicationFee
        };

        if (parsed.rentRows.length) {
          parsed.rentRows.forEach((rentRow, rentIndex) => {
            rows.push(RC.makeRow(Object.assign({}, base, {
              id: `${card.detailUrl}#${rentIndex + 1}`,
              unitSize: rentRow.unitSize,
              rent: rentRow.rent,
              rentText: rentRow.rentText,
              raw: { card, detail: parsed }
            })));
          });
        } else {
          rows.push(RC.makeRow(Object.assign({}, base, {
            id: card.detailUrl,
            raw: { card, detail: parsed }
          })));
        }
      } catch (error) {
        rows.push(RC.makeRow(Object.assign({}, hadleyCardToRow(card), {
          sourceType: "list+detail",
          raw: { error: error.message, card }
        })));
      }

      if (index < cards.length - 1) {
        await RC.sleep(500 + Math.floor(Math.random() * 401));
      }
    }

    return rows;
  }

  Object.assign(RC, {
    extractHadleyCardsFromListPage,
    extractHadleyCandidates,
    extractHadleyListingsWithDetailsForCards,
    parseHadleyDetailPage,
    extractHadleyBasic,
    extractHadleyListingsWithDetails
  });
})();
