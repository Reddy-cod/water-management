import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import dotenv from 'dotenv';
import { pool } from './db';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const isLiveRazorpay =
  process.env.RAZORPAY_KEY_ID &&
  !process.env.RAZORPAY_KEY_ID.includes('placeholder');

const razorpay = isLiveRazorpay
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    })
  : null;

// Helper: Calculate total fare in paise based on distance
function calculateFarePaise(
  basePricePaise: number,
  perKmPaise: number,
  distanceKm: number
) {
  const extraKm = Math.max(0, distanceKm - 5);
  const totalPaise = Math.round(basePricePaise + extraKm * perKmPaise);
  const platformFeePaise = Math.round(totalPaise * 0.10); // 10% Commission
  const sellerPayoutPaise = totalPaise - platformFeePaise; // 90% Seller Share
  return { totalPaise, platformFeePaise, sellerPayoutPaise };
}

// 1. Health Check
app.get('/api/health', async (_req: Request, res: Response) => {
  const dbCheck = await pool.query('SELECT NOW()');
  res.json({
    status: 'ok',
    time: dbCheck.rows[0].now,
    razorpayMode: isLiveRazorpay ? 'TEST_LIVE' : 'SANDBOX_MOCK',
  });
});

// 2. Get All Users (for quick demo switching) or Register New User
app.get('/api/users', async (_req: Request, res: Response) => {
  const { rows } = await pool.query('SELECT id, name, phone, role FROM users ORDER BY created_at ASC');
  res.json(rows);
});

app.post('/api/users/register', async (req: Request, res: Response) => {
  try {
    const { name, phone, role } = req.body;
    const mockLinkedAccount = role === 'SELLER' ? `acc_${crypto.randomBytes(6).toString('hex')}` : null;
    const { rows } = await pool.query(
      `INSERT INTO users (name, phone, role, razorpay_account_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, phone, role`,
      [name, phone, role, mockLinkedAccount]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Search Available Tankers Near Buyer's Location (PostGIS ST_DWithin)
app.get('/api/tankers/search', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const waterType = req.query.waterType && req.query.waterType !== 'ALL'
      ? (req.query.waterType as string)
      : null;

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Valid lat and lng query parameters are required.' });
    }

    const { rows } = await pool.query(
      `SELECT
        t.id,
        t.vehicle_number,
        t.area_name,
        t.capacity_liters,
        t.water_type,
        t.hose_length_ft,
        t.base_price_paise,
        t.per_km_paise,
        t.max_radius_meters,
        u.name AS seller_name,
        u.phone AS seller_phone,
        ROUND((ST_Distance(t.base_location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0)::numeric, 2) AS distance_km
      FROM tankers t
      JOIN users u ON u.id = t.seller_id
      WHERE t.is_available = TRUE
        AND ST_DWithin(
              t.base_location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              t.max_radius_meters
            )
        AND ($3::text IS NULL OR t.water_type = $3)
      ORDER BY distance_km ASC`,
      [lng, lat, waterType] // PostGIS expects (longitude, latitude)
    );

    const results = rows.map((row) => {
      const dist = parseFloat(row.distance_km);
      const pricing = calculateFarePaise(
        Number(row.base_price_paise),
        Number(row.per_km_paise),
        dist
      );
      return {
        ...row,
        distance_km: dist,
        total_inr: pricing.totalPaise / 100,
        platform_fee_inr: pricing.platformFeePaise / 100,
        seller_payout_inr: pricing.sellerPayoutPaise / 100,
      };
    });

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Seller: Register a New Tanker & Service Zone
app.post('/api/sellers/tankers', async (req: Request, res: Response) => {
  try {
    const {
      sellerId,
      vehicleNumber,
      areaName,
      capacityLiters,
      waterType,
      hoseLengthFt,
      lat,
      lng,
      radiusKm,
      basePriceInr,
      perKmInr,
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO tankers (
        seller_id, vehicle_number, area_name, capacity_liters, water_type,
        hose_length_ft, base_location, max_radius_meters, base_price_paise, per_km_paise
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9, $10, $11
      ) RETURNING id, vehicle_number, area_name, capacity_liters, water_type, is_available`,
      [
        sellerId,
        vehicleNumber.toUpperCase(),
        areaName,
        Number(capacityLiters),
        waterType,
        Number(hoseLengthFt || 50),
        Number(lng),
        Number(lat),
        Math.round(Number(radiusKm) * 1000),
        Math.round(Number(basePriceInr) * 100),
        Math.round(Number(perKmInr) * 100),
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Seller: Get Fleet & Toggle Availability
app.get('/api/sellers/:sellerId/tankers', async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT id, vehicle_number, area_name, capacity_liters, water_type,
            hose_length_ft, max_radius_meters, base_price_paise, per_km_paise, is_available
     FROM tankers WHERE seller_id = $1 ORDER BY created_at DESC`,
    [req.params.sellerId]
  );
  res.json(rows);
});

app.patch('/api/tankers/:id/toggle', async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `UPDATE tankers SET is_available = NOT is_available WHERE id = $1 RETURNING id, is_available`,
    [req.params.id]
  );
  res.json(rows[0]);
});

// 6. Buyer: Initiate Booking & Create Split-Payment Order (90% Seller / 10% Platform)
app.post('/api/bookings/checkout', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { buyerId, tankerId, buyerAddress, lat, lng } = req.body;
    await client.query('BEGIN');

    // Lock the tanker row to prevent double-booking race conditions
    const tankerRes = await client.query(
      `SELECT t.*, u.razorpay_account_id,
              ROUND((ST_Distance(t.base_location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0)::numeric, 2) AS distance_km
       FROM tankers t
       JOIN users u ON u.id = t.seller_id
       WHERE t.id = $3 FOR UPDATE`,
      [Number(lng), Number(lat), tankerId]
    );

    if (tankerRes.rows.length === 0 || !tankerRes.rows[0].is_available) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Sorry, this tanker was just booked by another customer.' });
    }

    const tanker = tankerRes.rows[0];
    const distKm = parseFloat(tanker.distance_km);
    const { totalPaise, platformFeePaise, sellerPayoutPaise } = calculateFarePaise(
      Number(tanker.base_price_paise),
      Number(tanker.per_km_paise),
      distKm
    );

    const deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();
    let razorpayOrderId = `order_demo_${crypto.randomBytes(6).toString('hex')}`;

    // If live Razorpay keys are present, create a Route Order with on_hold escrow transfer
    if (razorpay && tanker.razorpay_account_id) {
      const order: any = await razorpay.orders.create({
        amount: totalPaise,
        currency: 'INR',
        receipt: `tanker_${Date.now()}`,
        transfers: [
          {
            account: tanker.razorpay_account_id,
            amount: sellerPayoutPaise,
            currency: 'INR',
            on_hold: true, // Held in escrow until buyer shares delivery OTP
            notes: { role: 'tanker_owner_90_pct_payout' },
          },
        ],
      });
      razorpayOrderId = order.id;
    }

    const bookingRes = await client.query(
      `INSERT INTO bookings (
        buyer_id, tanker_id, buyer_address, delivery_location, distance_km,
        total_amount_paise, platform_fee_paise, seller_payout_paise,
        razorpay_order_id, delivery_otp, status
      ) VALUES (
        $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6,
        $7, $8, $9, $10, $11, 'PAYMENT_PENDING'
      ) RETURNING *`,
      [
        buyerId,
        tankerId,
        buyerAddress,
        Number(lng),
        Number(lat),
        distKm,
        totalPaise,
        platformFeePaise,
        sellerPayoutPaise,
        razorpayOrderId,
        deliveryOtp,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({
      booking: bookingRes.rows[0],
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      isDemoMode: !isLiveRazorpay,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 7. Verify Payment & Confirm Dispatch
app.post('/api/bookings/:id/confirm-payment', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { razorpay_payment_id, razorpay_signature, isDemo } = req.body;
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = rows[0];

    if (!isDemo && isLiveRazorpay) {
      const expectedSig = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
        .update(`${booking.razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (expectedSig !== razorpay_signature) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid payment signature' });
      }
    }

    const paymentId = razorpay_payment_id || `pay_demo_${crypto.randomBytes(6).toString('hex')}`;

    await client.query(
      `UPDATE bookings SET status = 'CONFIRMED', razorpay_payment_id = $1 WHERE id = $2`,
      [paymentId, booking.id]
    );

    await client.query(`UPDATE tankers SET is_available = FALSE WHERE id = $1`, [booking.tanker_id]);

    await client.query(
      `INSERT INTO ledger_entries (booking_id, entry_type, amount_paise, notes)
       VALUES ($1, 'ESCROW_CAPTURED', $2, $3)`,
      [booking.id, booking.total_amount_paise, `Payment captured via ${paymentId}`]
    );

    await client.query('COMMIT');
    res.json({ message: 'Payment verified and tanker dispatched!', deliveryOtp: booking.delivery_otp });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 8. Verify Delivery OTP -> Release 90% Payout to Seller & Retain 10% Commission
app.post('/api/bookings/:id/complete-delivery', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { otp } = req.body;
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = rows[0];
    if (booking.delivery_otp !== String(otp).trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Incorrect 4-digit Delivery OTP.' });
    }

    await client.query(`UPDATE bookings SET status = 'DELIVERED' WHERE id = $1`, [booking.id]);
    await client.query(`UPDATE tankers SET is_available = TRUE WHERE id = $1`, [booking.tanker_id]);

    // Double-entry ledger records for the 10% / 90% split
    await client.query(
      `INSERT INTO ledger_entries (booking_id, entry_type, amount_paise, notes) VALUES
       ($1, 'PLATFORM_COMMISSION_10PCT', $2, '10% marketplace fee settled to platform'),
       ($1, 'SELLER_PAYOUT_90PCT', $3, '90% escrow released to tanker owner')`,
      [booking.id, booking.platform_fee_paise, booking.seller_payout_paise]
    );

    await client.query('COMMIT');
    res.json({
      message: 'Delivery confirmed! 90% payout released to seller and 10% commission recorded.',
      sellerPayoutInr: Number(booking.seller_payout_paise) / 100,
      platformFeeInr: Number(booking.platform_fee_paise) / 100,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 9. List Bookings for Buyer or Seller
app.get('/api/bookings', async (req: Request, res: Response) => {
  const { userId, role } = req.query;
  const query =
    role === 'SELLER'
      ? `SELECT b.*, t.vehicle_number, t.capacity_liters, u.name AS buyer_name
         FROM bookings b
         JOIN tankers t ON t.id = b.tanker_id
         JOIN users u ON u.id = b.buyer_id
         WHERE t.seller_id = $1 ORDER BY b.created_at DESC`
      : `SELECT b.*, t.vehicle_number, t.capacity_liters, t.water_type, u.name AS seller_name
         FROM bookings b
         JOIN tankers t ON t.id = b.tanker_id
         JOIN users u ON u.id = t.seller_id
         WHERE b.buyer_id = $1 ORDER BY b.created_at DESC`;

  const { rows } = await pool.query(query, [userId]);
  res.json(rows);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`WaterManagement API running on http://localhost:${PORT}`);
});
