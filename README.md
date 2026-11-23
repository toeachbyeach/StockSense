# StockSense 🛒📈

StockSense is a self-hosted, automated price tracker and split-basket shopping optimizer designed for Australian shoppers and deal-hunters. It monitors product listings across major Australian retailers and Amazon, calculates standardized unit pricing across pack sizes, automatically detects price drops and specials, and dispatches real-time alerts.

---

## ✨ Features

- **Multi-Retailer Australian Price Tracking**:
  - **Supermarkets**: Coles, Woolworths
  - **Pet Stores**: Petbarn, Pet Circle, Petstock, Budget Pet Products, Pet Chemist
  - **Pharmacies**: Chemist Warehouse, Priceline, TerryWhite Chemmart, Cincotta Chemist, Blooms The Chemist
  - **Electronics & Hardware**: JB Hi-Fi, The Good Guys, Bunnings, Officeworks
  - **Online**: Amazon Australia (with ASIN extraction, Subscribe & Save, and Amazon Warehouse / Resale deals)
- **Split Basket Shopping List**:
  - Compares routine grocery and household items across stores to find the absolute lowest cost split basket.
  - Generates 1-click Click & Collect links for Coles and Woolworths.
  - Interactive in-store checklist for mobile shopping.
- **Smart Unit Pricing & Variation Matching**:
  - Automatically standardizes pricing per unit ($/100g, $/100ml, $/chew, $/tablet) so you can compare multi-packs, bulk sizes, and single items accurately.
  - Visual color mismatch and pack quantity variation alignment.
- **Used & Resale Deal Detection**:
  - Tracks Amazon Used, Very Good, and Like New resale discounts alongside brand-new listings.
- **Multi-Channel Instant Notifications**:
  - **Email** via Gmail or SMTP
  - **Discord** rich webhooks with direct product deals and Add-to-Cart buttons
  - **Telegram** bot integration
  - **NTFY** push notifications for mobile devices
  - Configurable Quiet Hours (Do Not Disturb) and custom sale drop thresholds.
- **Browser Bookmarklet**:
  - Add items to your watchlist with a single click while browsing any supported retailer.

---

## 🚀 Quick Start (Docker Compose)

The easiest way to run StockSense is using Docker and Docker Compose.

### 1. Create `docker-compose.yml`

```yaml
version: '3.8'

services:
  stocksense:
    image: ghcr.io/toeachbyeach/stocksense:main
    container_name: stocksense
    restart: unless-stopped
    init: true
    shm_size: '1gb'
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - TZ=Australia/Sydney
      - PASSWORD=changeme123
      - ENCRYPTION_KEY=your-random-32-char-secret-key-here
```

### 2. Launch the Application

```bash
docker compose up -d
```

Open your browser at `http://localhost:3000` and sign in with the configured `PASSWORD`.

---

## 🛠️ Local Development Setup

### Prerequisites
- Node.js (v20 or higher)
- npm

### 1. Clone the repository
```bash
git clone https://github.com/toeachbyeach/StockSense.git
cd StockSense
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and set your desired configuration:
```bash
cp .env.example .env
```

### 3. Install Dependencies & Build
```bash
# Install backend dependencies
cd backend
npm install
cd ..

# Install frontend dependencies and build assets
cd frontend
npm install
npm run build
cd ..
```

### 4. Start the Application
```bash
cd backend
npm start
```
The server will run at `http://localhost:3000`.

---

## ⚙️ Configuration & Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Web dashboard and API server port | `3000` |
| `TZ` | Container and scraper timezone | `Australia/Sydney` |
| `PASSWORD` | Admin password for logging into the web dashboard | `changeme123` |
| `ENCRYPTION_KEY` | 32-character key for JWT signing and credentials encryption | *(Required in production)* |
| `DEFAULT_SALE_THRESHOLD` | Percentage price drop vs 30-day average to flag as a sale | `20` |
| `DEFAULT_MIN_HISTORY` | Minimum historical data points required before computing average | `3` |
| `HEADLESS` | Run Puppeteer Chromium in headless mode | `true` |

*Note: Notification tokens (Gmail, Discord, Telegram, NTFY) can also be configured directly in the web UI under **Settings**.*

---

## 📱 Browser Bookmarklet

You can add items with one click while browsing any supported retailer:
1. Open StockSense and navigate to **Settings > Browser Bookmarklet**.
2. Drag the **Add to StockSense** button to your browser's Bookmarks bar.
3. When on any store's product page, click the bookmarklet to queue the item. StockSense will scrape the product and suggest matching alternatives automatically.

---

## 📄 License & Commercial Inquiries

StockSense is dual-licensed under the **GNU Affero General Public License v3.0 (AGPLv3)** and a **Commercial License**:

- **Open Source (AGPLv3)**: StockSense is free software for personal and self-hosted use. Anyone may use, inspect, and modify it under the terms of the AGPLv3. Any public network service or deployment based on modified versions must share its complete source code under AGPLv3.
- **Commercial License**: If you wish to use StockSense commercially, offer it as a paid hosted service, or integrate it into proprietary software without open-sourcing your stack, a commercial license is required.

For commercial inquiries, licensing, or custom integrations, please contact via [GitHub](https://github.com/toeachbyeach).
