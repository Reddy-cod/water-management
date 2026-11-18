CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Users (Buyers & Tanker Owners/Sellers)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(15) UNIQUE NOT NULL,
  role VARCHAR(10) NOT NULL CHECK (role IN ('BUYER', 'SELLER')),
  razorpay_account_id VARCHAR(64), -- Razorpay Route Linked Account ID (acc_xxx)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tanker Fleet & Service Zones
CREATE TABLE tankers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_number VARCHAR(20) UNIQUE NOT NULL,
  area_name VARCHAR(100) NOT NULL,
  capacity_liters INT NOT NULL CHECK (capacity_liters IN (6000, 8000, 12000)),
  water_type VARCHAR(20) NOT NULL CHECK (water_type IN ('POTABLE', 'TREATED')),
  hose_length_ft INT NOT NULL DEFAULT 50,
  base_location GEOGRAPHY(Point, 4326) NOT NULL, -- Note: ST_MakePoint(longitude, latitude)
  max_radius_meters INT NOT NULL DEFAULT 10000,
  base_price_paise BIGINT NOT NULL, -- Covers first 5 km
  per_km_paise BIGINT NOT NULL,     -- Charged per km after 5 km
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tankers_geo ON tankers USING GIST (base_location);
CREATE INDEX idx_tankers_avail ON tankers (is_available, water_type);

-- 3. Bookings & Escrow State
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES users(id),
  tanker_id UUID NOT NULL REFERENCES tankers(id),
  buyer_address TEXT NOT NULL,
  delivery_location GEOGRAPHY(Point, 4326) NOT NULL,
  distance_km NUMERIC(6, 2) NOT NULL,
  total_amount_paise BIGINT NOT NULL,
  platform_fee_paise BIGINT NOT NULL,   -- 10% Commission
  seller_payout_paise BIGINT NOT NULL,  -- 90% Seller Share
  razorpay_order_id VARCHAR(64) UNIQUE,
  razorpay_payment_id VARCHAR(64) UNIQUE,
  delivery_otp VARCHAR(6) NOT NULL,
  status VARCHAR(25) NOT NULL DEFAULT 'PAYMENT_PENDING'
    CHECK (status IN ('PAYMENT_PENDING', 'CONFIRMED', 'DELIVERED', 'CANCELLED')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Immutable Financial Ledger (Audit Trail)
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  entry_type VARCHAR(35) NOT NULL,
  amount_paise BIGINT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- SEED DATA (Bengaluru Demo Accounts & Fleet)
-- ==========================================
INSERT INTO users (id, name, phone, role, razorpay_account_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Prestige RWA Manager (Buyer)', '9880011111', 'BUYER', NULL),
  ('22222222-2222-2222-2222-222222222222', 'Kaveri Cauvery Water Suppliers', '9880022222', 'SELLER', 'acc_demo_seller_01'),
  ('33333333-3333-3333-3333-333333333333', 'Varthur Sri Balaji Tankers', '9880033333', 'SELLER', 'acc_demo_seller_02');

-- Note: PostGIS ST_MakePoint takes (Longitude, Latitude)
INSERT INTO tankers (seller_id, vehicle_number, area_name, capacity_liters, water_type, hose_length_ft, base_location, max_radius_meters, base_price_paise, per_km_paise) VALUES
  (
    '22222222-2222-2222-2222-222222222222',
    'KA-53-AB-4512',
    'Whitefield / ITPL',
    8000,
    'POTABLE',
    100,
    ST_SetSRID(ST_MakePoint(77.7499, 12.9698), 4326)::geography,
    12000,
    80000, -- ₹800 base
    4000   -- ₹40/km extra
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'KA-53-CD-8890',
    'Whitefield / Hope Farm',
    12000,
    'TREATED',
    150,
    ST_SetSRID(ST_MakePoint(77.7530, 12.9830), 4326)::geography,
    15000,
    95000, -- ₹950 base
    5000   -- ₹50/km extra
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'KA-01-EF-3321',
    'Sarjapur Road / Bellandur',
    6000,
    'POTABLE',
    80,
    ST_SetSRID(ST_MakePoint(77.6871, 12.9121), 4326)::geography,
    12000,
    70000, -- ₹700 base
    3500   -- ₹35/km extra
  );
