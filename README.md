# House Scout

Chrome Manifest V3 extension for collecting apartment listings, saving shortlists locally, calculating walking time to Jackson, and copying a clean comparison table into Google Docs or Google Sheets.

## Usage

1. Open a supported rental listing page.
2. Open the House Scout extension.
3. Use `Find unit candidates`.
4. Select the units you want.
5. Use `Extract selected units` or `Extract selected with details`.
6. Use `Save results` to keep them in local browser storage.
7. Use `Calc walk time` when you want Jackson walking time added.
8. Use `Copy Google table` and paste directly into Google Docs or Google Sheets.

## Google Table Columns

The one-click copy format uses tab-separated columns:

`이름, 면적, 월세, 유틸리티 포함(전기 제외), 세탁기, 잭슨 거리, 특징`

Laundry is normalized as:

- `O`: in-unit laundry or washer/dryer
- `X`: shared, common, on-site, or building laundry
- excluded: rows that explicitly say there is no laundry

The personal `문의 여부` column is not exported.

## Supported Sites

- Zillow
- Apartments.com
- Hadley Inc / Trumbull Enterprises
- East Rock Real Estate and Management / AppFolio embedded listings
- Generic fallback for a single visible listing

## Packaging

Run:

```powershell
.\package-extension.ps1
```

The package is written to:

```text
dist/Rental-Compare-0.1.0.zip
```

`dist/` is a generated build artifact and is intentionally not committed.

## Privacy

Saved rows stay in `chrome.storage.local`. The extension does not upload saved rows unless you manually copy or export them.
