# WaterManagement Bengaluru — Verified Tanker Marketplace

A full-stack hyperlocal water tanker marketplace built for Bengaluru with **PostgreSQL + PostGIS** geospatial radius matching, **Node.js + Express + TypeScript**, **React + Tailwind CSS**, and **90/10 automated escrow split payments** (Razorpay Route + 4-digit Delivery OTP release).

## Features
- **PostGIS Geospatial Matching (`ST_DWithin`):** Buyers set their Bengaluru locality/apartment location and instantly discover verified tankers whose active service radius covers their drop pin, sorted by distance and calculated fare.
- **Potable vs. Treated Water Filtering:** Separates domestic potable/borewell water from secondary/tertiary treated water for construction and flushing, plus hose-length visibility.
- **Race-Condition-Safe Booking (`FOR UPDATE`):** Row-level database locking prevents two buyers from booking the same tanker simultaneously.
- **90/10 Escrow Split & Delivery OTP:** Captures full payment upfront, holds funds in escrow, and releases **90%** to the tanker owner while retaining **10%** platform commission only after the buyer shares the 4-digit Delivery OTP.
- **Double-Entry Financial Ledger:** Every escrow capture, seller payout, and platform commission is recorded in an append-only `ledger_entries` table.
- **Seller Fleet Portal:** Tanker owners can register vehicles, define base coordinates, set service radius and slab pricing (`base_price` for first 5 km + `per_km` extra), and toggle live availability.

## Project Structure
```text
water-management/
├── docker-compose.yml        # PostgreSQL 16 + PostGIS 3.4 container
├── database/
│   └── schema.sql            # Tables, GIST spatial indexes & Bengaluru seed data
├── backend/                  # Express + TypeScript REST API
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── db.ts
│       └── server.ts
└── frontend/                 # React + Vite + Tailwind CSS SPA
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
        ├── main.tsx
        ├── index.css
        └── App.tsx
```

## Quick Start (Local Development)

### 1. Start PostgreSQL + PostGIS
```bash
docker compose up -d
```
*(Automatically initializes the `water_management` database and loads `database/schema.sql` with sample Bengaluru buyers, sellers, and tankers.)*

### 2. Start the Backend API
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```
Runs on `http://localhost:4000`.

### 3. Start the Frontend
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.
