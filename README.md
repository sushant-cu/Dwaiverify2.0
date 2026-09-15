# Dawai Sahi Hai

### Consumer-facing medicine verification and reporting prototype

**Dawai Sahi Hai** is a browser based prototype that explores a consumer-facing verification layer for medicines. Instead of treating a barcode or QR code as proof of authenticity by itself, the prototype combines multiple signals—reference/batch data, scan-activity patterns, and community reports to provide additional context for screening and review.

> **Important:** This is a prototype screening and evidence layer. A successful scan is **not** a laboratory test, a regulatory authenticity certificate, or a determination that a medicine is medically suitable or safe to consume. Production deployment would require validated manufacturer/regulatory data, security controls, moderation, and appropriate regulatory workflows.

## What the prototype does

### 1. Barcode / QR scanning
- Uses the browser camera for live barcode scanning.
- Supports browser-native `BarcodeDetector` where available.
- Falls back to **ZXing** when native barcode detection is unavailable.
- Supports EAN-13, EAN-8, UPC-A, UPC-E, Code 128 and Code 39 paths.
- Requires the same decoded value to be detected across **3 confirmations** before accepting a camera scan.
- Applies a check-digit validation gate to supported numeric retail barcode lengths (8, 12 and 13 digits).
- Provides manual barcode entry when camera scanning is unavailable.

### 2. Reference / batch database matching
The frontend loads medicine reference data. Each matching record can contain fields such as:

- Barcode
- Medicine name
- Manufacturer
- Batch prefix
- Expected/max scan volume
- Status

The current prototype also contains fallback demo data so the interface can still demonstrate the workflow when the live reference sheet cannot be loaded.

### 3. Multi-signal screening
The verification engine evaluates three signals together:

**Database Match**  
Checks whether the scanned barcode exists in the available reference database.

**Scan Volume Anomaly**  
Compares the local scan count for a barcode against the configured expected/max scan volume. A high count is treated as an anomaly signal, not proof of counterfeiting.

**Community Reports**  
Matches submitted reports using barcode and/or batch information. Reports create an alert signal for review.

The prototype can return these verdicts:

| Verdict | Meaning in this prototype |
|---|---|
| **VERIFIED** | Database match found, no scan-volume anomaly, and no matching community reports. This is a screening result—not proof of authenticity. |
| **ANOMALY** | Database match exists, but scan activity exceeds the configured threshold. |
| **SUSPICIOUS** | The reference record is explicitly flagged in the prototype database. |
| **REPORTED** | One or more community reports are associated with the barcode/batch. |
| **UNKNOWN** | Barcode is not present in the current reference database. |

## Community reporting

Users can submit a report with:

- Medicine name
- Batch number
- Chemist / city
- Description of what appeared unusual
- Optional barcode linkage when the report is started from a scan result

Reports are inserted optimistically into the current page and sent to a Google Apps Script web-app endpoint. The frontend then reads the published **Reports** sheet as a CSV so reports can persist across sessions.

The UI is intentionally explicit that community reports are **signals for verification and escalation**, not independently verified proof.

## Data flow

```text
Medicine barcode / QR
        |
        v
Browser scanner or manual entry
        |
        v
Barcode validation + 3-frame confirmation
        |
        v
Reference database match
        |
        +-------------------+
        |                   |
        v                   v
Scan-volume signal    Community reports
        |                   |
        +---------+---------+
                  |
                  v
          Screening verdict
                  |
                  v
       User-facing result + report workflow
```

## Current architecture

This repository is intentionally lightweight and does not use a frontend framework or build system.

```text
index.html
   |
   +--> style.css   (design system + responsive UI)
   |
   +--> app.js      (scanner, verification logic, reporting, UI behavior)
   |
   +--> ZXing CDN
   |
   +--> Papa Parse CDN
   |
   +--> Published Google Sheets CSV (reference data)
   |
   +--> Google Apps Script Web App (report writes)
   |
   +--> Published Google Sheets CSV (persistent reports)
```

### Frontend
- Semantic HTML
- Vanilla JavaScript
- CSS custom properties and responsive layout
- No Node.js build step required
- Designed for static hosting such as GitHub Pages

### External libraries
The current `index.html` loads:

- **ZXing JS library** for barcode decoding fallback.
- **Papa Parse** for CSV parsing.

Both are loaded from public CDNs at runtime.

## Repository files

| File | Purpose |
|---|---|
| `index.html` | Main application page, content, scanner UI, reporting form, FAQ, roadmap and footer |
| `app.js` | Database loading, barcode detection, checksum/confirmation logic, verification engine, community reports, counters and UI interactions |
| `style.css` | Visual design system, responsive layout, scanner styling, cards, animations and mobile navigation |
| `README.md` | Project documentation |

## Demo / test barcodes

The current prototype includes demo records for testing the UI and verification logic. Examples shown in the interface include:

| Barcode | Example state |
|---|---|
| `8901234567890` | Crocin 500mg — normal demo record |
| `8902345678901` | Dolo 650 — normal demo record |
| `8903456789012` | Azithral 500 — normal demo record |
| `0000000000000` | Explicitly flagged test record |
| `9999999999999` | Anomaly demonstration record with unusually high scan activity |

These are **prototype/demo records**, not claims about the authenticity of any real medicine package.

## Running locally

Because the application is static, you can run it with a simple local web server.

### Option 1 — Python

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

### Option 2 — VS Code

Use a local static-server extension such as Live Server, then open `index.html` through the served URL.

> Camera access generally works reliably in secure contexts such as `https://` or `http://localhost`. Opening the HTML directly as a `file://` URL can prevent camera access in some browsers.

## Configuration

The main configuration values are at the top of `app.js`.

### Reference database

`DB_URL` points to a **published Google Sheets CSV** containing the medicine reference data.

Expected fields used by the code include:

```text
barcode
medicine_name
manufacturer
batch_prefix
max_scans
status
```

If the live database cannot be loaded, the app falls back to its built-in demonstration records.

### Community report backend

The reporting flow uses:

- `REPORT_API_URL` — Google Apps Script Web App endpoint used to receive POSTed reports.
- `REPORTS_CSV_URL` — published CSV URL for the Reports sheet used by the frontend to reload persistent reports.

The Google Sheet should contain a Reports tab with fields equivalent to:

```text
timestamp | barcode | medicine | batch | location | issue | status
```

Do not put private credentials or service-account keys in this frontend repository. A browser-exposed URL should be treated as public.

## Deployment on GitHub Pages

1. Keep `index.html`, `app.js`, `style.css` and `README.md` in the repository root.
2. Configure `DB_URL`, `REPORT_API_URL` and `REPORTS_CSV_URL` in `app.js`.
3. Commit and push the files to the repository's selected branch.
4. In GitHub, enable **Pages** for the repository and select the appropriate branch/folder.
5. Open the generated GitHub Pages URL.
6. Test both camera scanning and manual barcode entry.
7. Test report submission separately and confirm the report appears in the published Reports CSV after the backend update.

## Verification logic in the current code

The current decision order is:

```text
No database match
    -> UNKNOWN

Explicit FLAGGED database record
    -> SUSPICIOUS

Scan count > 80% of configured max_scans
    -> ANOMALY

Matching community report exists
    -> REPORTED

Otherwise
    -> VERIFIED
```

The scan-volume counter in the current implementation is maintained in browser `localStorage`. It therefore represents **local/demo scan activity**, not a trusted multi-user global scan count.

The application also stores pending report data in `localStorage` as a temporary fallback until the backend report feed is refreshed.

## Design and UX principles

The interface is designed around a product-style, mobile-first experience:

- Off-white canvas and glass-style panels
- India-tinted saffron/green atmospheric accents
- Sticky navigation with mobile menu
- Scroll-reveal transitions
- Lightweight hero device interaction on hover-capable devices
- Live scanner panel with confirmation indicator
- Clear result states for verification, anomaly, suspicious, reported and unknown conditions
- Community alert feed
- Public reporting form
- Prototype metrics section
- Roadmap and FAQ for technical/product explanation

The interface deliberately includes safety/prototype notices so demo results are not presented as regulatory certification.

## Product positioning

Dawai Sahi Hai is intended as a **consumer-facing trust and evidence layer** that can connect product reference data, scan behaviour and citizen reporting.

It is not intended to replace:

- Drug regulators
- Laboratory testing
- Manufacturer quality-control systems
- Authorized traceability/serialization infrastructure
- Licensed healthcare professionals

A production version would need authorized data partnerships, stronger server-side telemetry, identity and abuse controls, audit trails, data governance, security engineering, moderation and regulatory integration.

## Roadmap

### Current prototype
- Browser barcode scanning
- Manual barcode fallback
- Multi-frame confirmation
- Check-digit gate for supported numeric codes
- Reference database matching
- Scan-volume anomaly signal
- Community reporting
- Google Sheets / Apps Script persistence path
- Responsive product-style web UI

### Next stage
- Larger validated product/batch registry
- Manufacturer and pharmacy partnerships
- Server-side scan telemetry
- Stronger anti-abuse controls
- Report moderation and structured incident workflow
- Authentication and audit logging
- Better batch-level and serialization-aware logic

### Long-term direction
- Authorized integration with applicable CDSCO / State regulatory and product-data systems
- Manufacturer-issued serialization / traceability data where available
- More robust anomaly detection
- Optional physical packaging inspection / computer-vision screening as a separate evidence signal
- Closed-loop escalation from consumer report to pharmacy, manufacturer and appropriate authority

## Evidence and references

The public website currently links to the following reference material:

- **WHO — Substandard and falsified medical products**  
  https://www.who.int/news-room/fact-sheets/detail/substandard-and-falsified-medical-products

- **UNICEF Supply Division — Traceability and Verification System (TRVST)**  
  https://www.unicef.org/supply/traceability-and-verification-system-trvst

The prototype uses these sources as contextual evidence for the problem framing. It does not claim that its own screening output has regulatory or laboratory equivalence.

## Limitations

This repository is a working prototype, not a production medicine-authentication service. In particular:

- The reference dataset is limited and manually configured for the prototype.
- Scan-volume telemetry is currently browser-local/demo activity.
- Community submissions are not independently verified by the frontend.
- Google Sheets / Apps Script is a prototype persistence mechanism, not a production data architecture.
- Barcode presence alone cannot establish that the physical medicine pack is authentic.
- A database miss means **“not in this database yet”**, not “counterfeit.”
- An anomaly means **“needs investigation”**, not “counterfeit proven.”
- Production use would require formal regulatory, privacy, security and operational review.

## Safety note

Do not use this prototype to make a medical treatment decision. For suspected medicine quality or authenticity issues, retain appropriate evidence and use official reporting channels and qualified healthcare professionals.

---

**Dawai Sahi Hai**  
Built as a technology prototype exploring medicine verification, traceability context and citizen reporting.
