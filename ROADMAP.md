# StockSense Future Feature Roadmap

This document outlines features scheduled for subsequent releases after the current production launch.

---

### 1. Browser Extension (Item #11)
- **Status:** Planned
- **Details:**
  - Build a lightweight Google Chrome / Firefox Manifest V3 browser extension.
  - Automatically detect when a user is browsing supported Australian shopping sites (Amazon, Bunnings, JB Hi-Fi, The Good Guys, Coles, Woolworths, Chemist Warehouse, Pet Circle, Officeworks, The Iconic).
  - Provide an inline price history chart directly embedded in product pages (similar to Keepa/CamelCamelCamel).
  - One-click button to sync or track directly into StockSense with immediate competitor cross-price comparison.

---

### 2. Barcode & EAN-13 Physical Store Scanner (Item #13)
- **Status:** Planned
- **Details:**
  - In-store camera barcode scanner utilizing the HTML5 `BarcodeDetector` API / `@zxing/library`.
  - While physically shopping in-store at Bunnings, Woolworths, or Coles, scanning a product's barcode will instantly query StockSense to check if online competitors (Amazon, The Good Guys, Chemist Warehouse) offer a better deal.
  - Automatic EAN-13 to retailer product search mapping.

---

### 3. Native App Store Distribution & Advanced PWA (Item #12 Extension)
- **Status:** Phase 2 (PWA Manifest & Mobile Web App is enabled in current release)
- **Details:**
  - Wrap the responsive PWA with Capacitor or React Native for distribution on the Google Play Store and Apple App Store.
  - Local push notifications via native device push services (APNs / FCM).
