(function () {
  "use strict";

  const RC = window.RentalCompare = window.RentalCompare || {};

  function findZillowState(doc) {
    const scripts = Array.from(doc.querySelectorAll("script")).map((script) => script.textContent || "");
    const stateScript = scripts.find((text) => text.includes("hdpApolloPreloadedData") || text.includes("searchPageState") || text.includes('"address"'));
    return stateScript ? stateScript.slice(0, 20000) : null;
  }

  function moneyRange(text) {
    const value = RC.cleanText(text) || "";
    const match = value.match(/\$[0-9][0-9,]*(?:\+|\/mo)?(?:\s*[-\u2013\u2014]\s*\$?[0-9][0-9,]*(?:\+|\/mo)?)?/);
    return RC.cleanText(match && match[0]);
  }

  function parseCardTitleAddress(lines) {
    const pipeLine = lines.find((line) => line.includes(" | "));
    if (pipeLine) {
      const parts = pipeLine.split(" | ").map(RC.cleanText).filter(Boolean);
      return { title: parts[0] || null, address: parts.slice(1).join(" | ") || null };
    }

    const addressLine = lines.find((line) => /\b[A-Z]{2}\s*\d{5}\b|,\s*[A-Z]{2}\b/.test(line));
    return {
      title: lines.find((line) => line && !/^\$|Total monthly|Save|Previous|Next|Check availability|More$/i.test(line)) || null,
      address: addressLine || null
    };
  }

  function zillowCardToRow(card, index) {
    const text = RC.cleanText(card.innerText || card.textContent) || "";
    const lines = (card.innerText || card.textContent || "").split(/\n+/).map(RC.cleanText).filter(Boolean);
    const link = card.querySelector('a[href*="/homedetails/"], a[href*="/apartments/"], a[href*="/b/"], a[href]');
    const detailUrl = RC.absolutizeUrl(link && link.getAttribute("href"));
    const titleAddress = parseCardTitleAddress(lines);
    const rentText = moneyRange(text);
    const bedBath = RC.parseBedBath(text);
    const sqft = RC.parseSqft(text);
    const image = card.querySelector("img");

    return RC.makeRow({
      id: detailUrl || `zillow-card-${index + 1}`,
      site: "Zillow",
      sourceType: "list-page",
      name: titleAddress.title,
      title: titleAddress.title,
      address: titleAddress.address,
      rent: RC.moneyToNumber(rentText),
      rentText,
      beds: bedBath.beds,
      baths: bedBath.baths,
      sqft,
      imageUrl: RC.absolutizeUrl(image && (image.getAttribute("src") || image.getAttribute("data-src"))),
      detailUrl,
      raw: { source: "zillow-search-card", textSnippet: text.slice(0, 1000) }
    });
  }

  function extractZillowSearchCards(doc) {
    const articles = Array.from(doc.querySelectorAll("article.property-card, [data-test='property-card']"))
      .filter((card) => /\$[0-9]/.test(card.innerText || card.textContent || ""));
    const cards = articles.length ? articles : Array.from(doc.querySelectorAll("li"))
      .filter((card) => /\$[0-9]/.test(card.innerText || card.textContent || "") && card.querySelector('a[href*="/homedetails/"], a[href*="/apartments/"], a[href*="/b/"]'));

    const seen = new Set();
    return cards.map(zillowCardToRow).filter((row) => {
      const key = row.detailUrl || row.raw.textSnippet;
      if (seen.has(key)) return false;
      seen.add(key);
      return row.detailUrl || row.rentText || row.address;
    });
  }

  function extractZillowDetailRows(doc, pageUrl, seed) {
    const jsonLd = RC.extractJsonLd(doc);
    const listing = jsonLd.find((item) => /Apartment|Residence|Product|Place|House|Offer/i.test(String(item["@type"] || ""))) || {};
    const stateText = findZillowState(doc);
    const title = RC.cleanText(listing.name) || RC.attrFromSelectors(doc, ["meta[property='og:title']", "meta[name='twitter:title']"], "content") || RC.cleanText(doc.title) || seed.title || seed.name;
    const description = RC.cleanText(listing.description) || RC.attrFromSelectors(doc, ["meta[property='og:description']", "meta[name='description']"], "content") || seed.description;
    const image = Array.isArray(listing.image) ? listing.image[0] : listing.image;
    const imageUrl = RC.absolutizeUrl(image || RC.attrFromSelectors(doc, ["meta[property='og:image']"], "content"), pageUrl) || seed.imageUrl;
    const address = RC.parseAddressObject(listing.address) || RC.textFromSelectors(doc, ["[data-testid='home-details-summary-headline']", "address"]) || seed.address;
    const geo = listing.geo || {};
    const pageText = RC.cleanText(doc.body && doc.body.innerText) || "";
    const rentText = seed.rentText || moneyRange(pageText);
    const bedBath = RC.parseBedBath(pageText);
    const sqft = RC.parseSqft(pageText) || seed.sqft;
    const amenities = Array.from(doc.querySelectorAll("[data-testid*='amenity'], .amenity, li"))
      .map((node) => RC.cleanText(node.textContent))
      .filter((text) => text && text.length < 80);

    const base = Object.assign({}, seed, {
      id: seed.id || pageUrl,
      site: "Zillow",
      sourceType: "detail-page",
      name: title,
      title,
      address,
      rent: RC.moneyToNumber(rentText),
      rentText,
      minRent: RC.moneyToNumber(rentText),
      beds: bedBath.beds || seed.beds,
      baths: bedBath.baths || seed.baths,
      sqft,
      amenities: RC.uniqueArray((seed.amenities || []).concat(amenities)).slice(0, 30),
      pets: RC.extractLabelValueFromText(pageText, "Pets") || seed.pets,
      laundry: RC.extractLabelValueFromText(pageText, "Laundry") || seed.laundry,
      parking: RC.extractLabelValueFromText(pageText, "Parking") || seed.parking,
      description,
      imageUrl,
      detailUrl: pageUrl,
      pageUrl,
      latitude: geo.latitude ? Number(geo.latitude) : seed.latitude,
      longitude: geo.longitude ? Number(geo.longitude) : seed.longitude,
      phone: RC.cleanText((pageText.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/) || [])[0]) || seed.phone,
      raw: { jsonLdCount: jsonLd.length, stateSnippet: stateText && stateText.slice(0, 1000), seed }
    });

    const unitRows = extractZillowAvailableUnitRows(pageText, pageUrl, base);
    return unitRows.length ? unitRows : [RC.makeRow(base)];
  }

  function extractZillowAvailableUnitRows(text, pageUrl, base) {
    const rows = [];
    const normalized = String(text || "").replace(/\s+/g, " ");
    const regex = /Unit\s+([A-Za-z0-9-]+)\s*(Studio|\d+\s*bd),\s*([0-9.]+)\s*ba\s*Floor plan\s*([0-9,]+)\s*(Now|[A-Z][a-z]{2,8}\s+\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\s*\$([0-9,]+)/gi;
    let match;

    while ((match = regex.exec(normalized))) {
      const unitNumber = RC.cleanText(match[1]);
      const bedText = RC.cleanText(match[2]);
      const baths = Number(match[3]);
      const sqft = Number(match[4].replace(/,/g, ""));
      const available = RC.cleanText(match[5]);
      const rent = Number(match[6].replace(/,/g, ""));
      const rentText = `$${match[6]}`;

      rows.push(RC.makeRow(Object.assign({}, base, {
        id: `${pageUrl}#${unitNumber}`,
        sourceType: "list+detail",
        unitSize: unitNumber,
        rent,
        rentText,
        beds: /^studio$/i.test(bedText) ? "Studio" : Number((bedText.match(/\d+/) || [])[0]),
        baths,
        sqft,
        available,
        raw: Object.assign({}, base.raw || {}, {
          zillowUnit: { unitNumber, bedText, baths, sqft, available, rent }
        })
      })));
    }

    return rows;
  }

  function extractZillow(doc) {
    const cards = extractZillowSearchCards(doc);
    if (cards.length) return cards;
    return extractZillowDetailRows(doc, location.href, RC.makeRow({ site: "Zillow", detailUrl: location.href }));
  }

  function extractZillowCandidates(doc) {
    return extractZillow(doc).map((row, index) => Object.assign({}, row, {
      candidateId: row.detailUrl || row.id || `zillow-${index + 1}`,
      candidateLabel: [row.title || row.name, row.address, row.rentText, [row.beds, row.baths, row.sqft].filter(Boolean).join(" / ")].filter(Boolean).join(" | "),
      candidateType: row.sourceType === "list-page" ? "zillow-search-card" : "zillow-detail-row"
    }));
  }

  async function extractZillowDetailsForCandidates(candidates, progressCallback) {
    const rows = [];
    const total = candidates.length;

    for (let index = 0; index < candidates.length; index += 1) {
      const seed = candidates[index];
      if (progressCallback) progressCallback({ current: index + 1, total, label: seed.title || seed.address || "Zillow detail", url: seed.detailUrl });

      if (!seed.detailUrl) {
        rows.push(RC.makeRow(Object.assign({}, seed, { raw: Object.assign({}, seed.raw || {}, { error: "detail URL not found" }) })));
        continue;
      }

      try {
        const response = await fetch(seed.detailUrl, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const detailDoc = new DOMParser().parseFromString(html, "text/html");
        rows.push(...extractZillowDetailRows(detailDoc, seed.detailUrl, seed));
      } catch (error) {
        rows.push(RC.makeRow(Object.assign({}, seed, {
          sourceType: "list+detail",
          raw: Object.assign({}, seed.raw || {}, { error: error.message })
        })));
      }

      if (index < candidates.length - 1) {
        await RC.sleep(500 + Math.floor(Math.random() * 401));
      }
    }

    return rows;
  }

  Object.assign(RC, {
    extractZillow,
    extractZillowCandidates,
    extractZillowSearchCards,
    extractZillowDetailsForCandidates
  });
})();
