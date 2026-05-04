(function () {
  "use strict";

  const RC = window.RentalCompare = window.RentalCompare || {};

  function extractGeneric(doc) {
    const description = RC.attrFromSelectors(doc, ["meta[name='description']", "meta[property='og:description']"], "content");
    const imageUrl = RC.absolutizeUrl(RC.attrFromSelectors(doc, ["meta[property='og:image']"], "content"));
    const canonical = RC.absolutizeUrl(RC.attrFromSelectors(doc, ["link[rel='canonical']"], "href")) || location.href;
    const text = RC.cleanText(doc.body && doc.body.innerText) || "";
    const rentMatch = text.match(/\$[0-9][0-9,]*(?:\s*-\s*\$?[0-9][0-9,]*)?/);
    const addressMatch = text.match(/\b[0-9]{1,6}\s+[A-Za-z0-9 .'-]+,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s*[0-9]{5}\b/);

    return [RC.makeRow({
      site: "Generic",
      sourceType: "generic",
      name: RC.cleanText(doc.title),
      title: RC.cleanText(doc.title),
      address: RC.cleanText(addressMatch && addressMatch[0]),
      rent: RC.moneyToNumber(rentMatch && rentMatch[0]),
      rentText: RC.cleanText(rentMatch && rentMatch[0]),
      description,
      imageUrl,
      detailUrl: canonical,
      pageUrl: canonical,
      raw: { source: "generic-fallback" }
    })];
  }

  RC.extractGeneric = extractGeneric;
})();
