(function () {
  "use strict";

  const RC = window.RentalCompare = window.RentalCompare || {};

  function getDetailPairs(card) {
    const pairs = {};
    card.querySelectorAll(".detail-box__item").forEach((item) => {
      const dt = RC.cleanText(item.querySelector("dt") && item.querySelector("dt").textContent);
      const dd = RC.cleanText(item.querySelector("dd") && item.querySelector("dd").textContent);
      if (dt && dd) pairs[dt.toLowerCase()] = dd;
    });
    return pairs;
  }

  function valueFor(pairs, labels) {
    const keys = Object.keys(pairs);
    for (const label of labels) {
      const key = keys.find((candidate) => candidate.includes(label));
      if (key) return pairs[key];
    }
    return null;
  }

  function extractEastRockListings(doc) {
    const items = Array.from(doc.querySelectorAll(".js-listing-item"));
    return items.map((card, index) => {
      const pairs = getDetailPairs(card);
      const titleLink = card.querySelector(".js-listing-title a") || card.querySelector(".js-link-to-detail") || card.querySelector("a[href]");
      const title = RC.cleanText(titleLink && titleLink.textContent) || RC.textFromSelectors(card, [".js-listing-title"]);
      const detailUrl = RC.absolutizeUrl(titleLink && titleLink.getAttribute("href"));
      const address = RC.textFromSelectors(card, [".js-listing-address"]);
      const rentText = valueFor(pairs, ["rent"]);
      const sqftText = valueFor(pairs, ["square", "sq"]);
      const bedBathText = valueFor(pairs, ["bed", "bath"]) || RC.cleanText(card.textContent);
      const parsed = RC.parseBedBath(bedBathText);
      const fullText = [card.innerText, card.textContent].filter(Boolean).join("\n");
      const imageNode = card.querySelector(".js-listing-image");
      const imageUrl = RC.absolutizeUrl(
        imageNode && (imageNode.getAttribute("data-original") || imageNode.getAttribute("src") || imageNode.style.backgroundImage.replace(/^url\(["']?|["']?\)$/g, ""))
      );

      return RC.makeRow({
        id: detailUrl || `east-rock-${index + 1}`,
        site: "East Rock/AppFolio",
        sourceType: "list-page",
        name: title,
        title,
        address,
        rent: RC.moneyToNumber(rentText),
        rentText,
        beds: parsed.beds,
        baths: parsed.baths,
        sqft: RC.parseSqft(sqftText),
        available: valueFor(pairs, ["available"]),
        utilitiesIncluded: RC.extractLabelValueFromText(fullText, "Utilities Included"),
        appliances: RC.extractLabelValueFromText(fullText, "Appliances"),
        pets: RC.extractLabelValueFromText(fullText, "Pet Policy") || RC.extractLabelValueFromText(fullText, "Pets"),
        description: RC.textFromSelectors(card, [".js-listing-description"]),
        imageUrl,
        detailUrl,
        raw: { detailPairs: pairs }
      });
    });
  }

  function extractEastRockCandidates(doc) {
    return extractEastRockListings(doc).map((row, index) => Object.assign({}, row, {
      candidateId: row.id || `east-rock-${index + 1}`,
      candidateLabel: [row.title || row.name, row.address, row.rentText, row.available].filter(Boolean).join(" | "),
      candidateType: "appfolio-listing"
    }));
  }

  RC.extractEastRockListings = extractEastRockListings;
  RC.extractEastRockCandidates = extractEastRockCandidates;
})();
