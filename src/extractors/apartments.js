(function () {
  "use strict";

  const RC = window.RentalCompare = window.RentalCompare || {};

  function extractRentText(text) {
    const value = RC.cleanText(text) || "";
    const match = value.match(/\$[0-9][0-9,]*(?:\s*[-\u2013\u2014]\s*\$?[0-9][0-9,]*)?/);
    return RC.cleanText(match && match[0]);
  }

  function findFloorPlanCards(doc) {
    const directCards = Array.from(doc.querySelectorAll(
      "#pricingView .pricingGridItem, #availabilitySection .pricingGridItem, .availabilitySection .pricingGridItem, [class*='pricingGridItem']"
    )).filter((node) => {
      const text = RC.cleanText(node.innerText || node.textContent) || "";
      return /\$[0-9]/.test(text) && /(Floor Plan Details|Available|Studio|Bed|Bath)/i.test(text);
    });
    if (directCards.length) return directCards;

    const candidates = Array.from(doc.querySelectorAll("section, article, div, li"))
      .filter((node) => {
        const text = RC.cleanText(node.innerText || node.textContent) || "";
        return (/Available Unit/i.test(text) && /(Base|Total)\s*Price/i.test(text) && /Sq\s*Ft/i.test(text)) ||
          (/Floor Plan Details/i.test(text) && /\$[0-9]/.test(text) && /(Studio|Bed|Bath)/i.test(text));
      });

    return candidates.filter((node) => !candidates.some((other) => other !== node && node.contains(other)));
  }

  function headingForCard(card) {
    const heading = card.querySelector("h2,h3,h4,[class*='floorPlanName'],[class*='modelName'],[data-testid*='floor']");
    if (heading) return RC.cleanText(heading.textContent);
    const lines = (card.innerText || card.textContent || "").split(/\n+/).map(RC.cleanText).filter(Boolean);
    return lines.find((line) => !/Pricing|Matches|Available|Base Price|Total Price|Unit Details|Send Message|View More/i.test(line)) || null;
  }

  function parseFloorPlanSummary(card) {
    const text = RC.cleanText(card.innerText || card.textContent) || "";
    const rentText = extractRentText(text);
    const sqft = RC.parseSqft(text);
    const bedBath = RC.parseBedBath(text);
    const availableMatch = text.match(/Available\s+(Now|[A-Z][a-z]{2,8}\s+\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    return {
      rentText,
      rent: RC.moneyToNumber(rentText),
      sqft,
      beds: bedBath.beds,
      baths: bedBath.baths,
      available: RC.cleanText(availableMatch && availableMatch[0])
    };
  }

  function tableRowsFromCard(card) {
    const rows = [];
    card.querySelectorAll("table tr").forEach((tr) => {
      const cells = Array.from(tr.children).map((cell) => RC.cleanText(cell.textContent)).filter(Boolean);
      if (cells.length >= 4 && !/unit/i.test(cells.join(" "))) {
        rows.push({ unit: cells[0], rentText: cells[1], sqftText: cells[2], available: cells[3] });
      }
    });
    if (rows.length) return rows;

    const lines = (card.innerText || card.textContent || "").split(/\n+/).map(RC.cleanText).filter(Boolean);
    const headerIndex = lines.findIndex((line, index) => /^Unit$/i.test(line) && /(Base|Total)\s*Price/i.test(lines[index + 1] || ""));
    if (headerIndex >= 0) {
      for (let index = headerIndex + 5; index < lines.length - 7; index += 1) {
        if (/^Unit$/i.test(lines[index]) && /^price$/i.test(lines[index + 2] || "") && /^square feet$/i.test(lines[index + 4] || "")) {
          rows.push({
            unit: lines[index + 1],
            rentText: lines[index + 3],
            sqftText: lines[index + 5],
            available: /^avail/i.test(lines[index + 6] || "") ? lines[index + 7] : null
          });
          index += 7;
        }
      }
    }
    return rows;
  }

  function extractApartmentsFloorPlanRows(doc, base) {
    const cards = findFloorPlanCards(doc);
    const rows = [];

    cards.forEach((card, cardIndex) => {
      const floorPlanTitle = headingForCard(card);
      const summary = parseFloorPlanSummary(card);
      const unitRows = tableRowsFromCard(card);

      if (unitRows.length) {
        unitRows.forEach((unit, unitIndex) => {
          const bedBath = RC.parseBedBath(card.innerText || card.textContent);
          rows.push(RC.makeRow(Object.assign({}, base, {
            id: `${location.href}#floorplan-${cardIndex + 1}-unit-${unitIndex + 1}`,
            sourceType: "list-page",
            title: floorPlanTitle || base.title,
            unitSize: unit.unit || floorPlanTitle,
            rent: RC.moneyToNumber(unit.rentText) || summary.rent,
            rentText: unit.rentText || summary.rentText,
            beds: bedBath.beds || summary.beds,
            baths: bedBath.baths || summary.baths,
            sqft: RC.parseSqft(unit.sqftText) || summary.sqft,
            available: unit.available || summary.available,
            raw: { source: "apartments-floorplan-unit", floorPlanTitle }
          })));
        });
      } else if (summary.rent || floorPlanTitle) {
        rows.push(RC.makeRow(Object.assign({}, base, {
          id: `${location.href}#floorplan-${cardIndex + 1}`,
          sourceType: "list-page",
          title: floorPlanTitle || base.title,
          unitSize: floorPlanTitle,
          rent: summary.rent,
          rentText: summary.rentText,
          beds: summary.beds,
          baths: summary.baths,
          sqft: summary.sqft,
          available: summary.available,
          raw: { source: "apartments-floorplan", floorPlanTitle }
        })));
      }
    });

    return rows;
  }

  function extractApartmentsBase(doc) {
    const jsonLd = RC.extractJsonLd(doc);
    const listing = jsonLd.find((item) => /Apartment|Residence|LocalBusiness|Place|Product/i.test(String(item["@type"] || ""))) || {};
    const title = RC.cleanText(listing.name) || RC.attrFromSelectors(doc, ["meta[property='og:title']", "meta[name='twitter:title']"], "content") || RC.cleanText(doc.title);
    const description = RC.cleanText(listing.description) || RC.attrFromSelectors(doc, ["meta[name='description']", "meta[property='og:description']"], "content");
    const address = RC.parseAddressObject(listing.address) || RC.textFromSelectors(doc, ["#propertyAddress", ".propertyAddress", "address"]);
    const pageText = RC.cleanText(doc.body && doc.body.innerText) || "";
    const rentText = extractRentText(pageText);
    const rentNumbers = rentText ? rentText.match(/[0-9][0-9,]*/g).map((num) => Number(num.replace(/,/g, ""))) : [];
    const bedBath = RC.parseBedBath(pageText);
    const amenities = Array.from(doc.querySelectorAll(".amenity, [class*='amenity'], li"))
      .map((node) => RC.cleanText(node.textContent))
      .filter((text) => text && text.length < 80);
    const geo = listing.geo || {};

    return {
      site: "Apartments.com",
      sourceType: "detail-page",
      name: title,
      title,
      address,
      rent: rentNumbers[0] || null,
      rentText,
      minRent: rentNumbers[0] || null,
      maxRent: rentNumbers[1] || rentNumbers[0] || null,
      beds: bedBath.beds,
      baths: bedBath.baths,
      sqft: RC.parseSqft(pageText),
      available: RC.extractLabelValueFromText(pageText, "Available"),
      utilitiesIncluded: RC.extractLabelValueFromText(pageText, "Utilities Included"),
      parking: RC.extractLabelValueFromText(pageText, "Parking"),
      pets: RC.extractLabelValueFromText(pageText, "Pet Policy") || RC.extractLabelValueFromText(pageText, "Pets"),
      amenities: RC.uniqueArray(amenities).slice(0, 30),
      description,
      imageUrl: RC.absolutizeUrl((Array.isArray(listing.image) ? listing.image[0] : listing.image) || RC.attrFromSelectors(doc, ["meta[property='og:image']"], "content")),
      detailUrl: location.href,
      latitude: geo.latitude ? Number(geo.latitude) : null,
      longitude: geo.longitude ? Number(geo.longitude) : null,
      phone: RC.cleanText((pageText.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/) || [])[0]),
      raw: { jsonLdCount: jsonLd.length }
    };
  }

  function extractApartmentsCom(doc) {
    const base = extractApartmentsBase(doc);
    const unitRows = extractApartmentsFloorPlanRows(doc, base);
    return unitRows.length ? unitRows : [RC.makeRow(base)];
  }

  function extractApartmentsCandidates(doc) {
    return extractApartmentsCom(doc).map((row, index) => Object.assign({}, row, {
      candidateId: row.id || `apartments-${index + 1}`,
      candidateLabel: [row.title || row.name, row.unitSize, row.rentText, row.available].filter(Boolean).join(" | "),
      candidateType: row.raw && row.raw.source ? row.raw.source : "apartments-row"
    }));
  }

  RC.extractApartmentsCom = extractApartmentsCom;
  RC.extractApartmentsCandidates = extractApartmentsCandidates;
})();
