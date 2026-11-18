import React, { useEffect, useState } from 'react';
import {
  Droplets,
  MapPin,
  Truck,
  ShieldCheck,
  PlusCircle,
  CheckCircle2,
  IndianRupee,
  Navigation,
} from 'lucide-react';

const BENGALURU_HUBS = [
  { name: 'Whitefield (ITPL)', lat: 12.9698, lng: 77.7499 },
  { name: 'Sarjapur Road', lat: 12.9121, lng: 77.6871 },
  { name: 'Bellandur', lat: 12.9260, lng: 77.6762 },
  { name: 'Electronic City', lat: 12.8452, lng: 77.6602 },
  { name: 'Indiranagar', lat: 12.9784, lng: 77.6408 },
];

export default function App() {
  const [users, setUsers] = useState<any[]>([]);
  const [activeUser, setActiveUser] = useState<any>(null);
  const [newUserForm, setNewUserForm] = useState({ name: '', phone: '', role: 'BUYER' });

  // Buyer State
  const [selectedHub, setSelectedHub] = useState(BENGALURU_HUBS[0]);
  const [buyerAddress, setBuyerAddress] = useState('Prestige Shantiniketan, Gate 2, Whitefield');
  const [waterFilter, setWaterFilter] = useState('ALL');
  const [tankers, setTankers] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});

  // Seller State
  const [sellerFleet, setSellerFleet] = useState<any[]>([]);
  const [tankerForm, setTankerForm] = useState({
    vehicleNumber: '',
    hubIndex: 0,
    capacityLiters: 8000,
    waterType: 'POTABLE',
    hoseLengthFt: 100,
    radiusKm: 12,
    basePriceInr: 850,
    perKmInr: 40,
  });

  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (!activeUser) return;
    fetchBookings();
    if (activeUser.role === 'BUYER') {
      searchTankers();
    } else {
      fetchSellerFleet();
    }
  }, [activeUser, selectedHub, waterFilter]);

  async function fetchUsers() {
    const res = await fetch('/api/users');
    const data = await res.json();
    setUsers(data);
    if (data.length > 0 && !activeUser) setActiveUser(data[0]);
  }

  async function handleRegisterUser(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/users/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUserForm),
    });
    const created = await res.json();
    if (res.ok) {
      await fetchUsers();
      setActiveUser(created);
      setNewUserForm({ name: '', phone: '', role: 'BUYER' });
      setStatusBanner(`Registered & switched to ${created.name} (${created.role})`);
    }
  }

  async function searchTankers() {
    const params = new URLSearchParams({
      lat: String(selectedHub.lat),
      lng: String(selectedHub.lng),
      waterType: waterFilter,
    });
    const res = await fetch(`/api/tankers/search?${params}`);
    const data = await res.json();
    setTankers(Array.isArray(data) ? data : []);
  }

  async function fetchSellerFleet() {
    if (!activeUser) return;
    const res = await fetch(`/api/sellers/${activeUser.id}/tankers`);
    setSellerFleet(await res.json());
  }

  async function fetchBookings() {
    if (!activeUser) return;
    const res = await fetch(`/api/bookings?userId=${activeUser.id}&role=${activeUser.role}`);
    setBookings(await res.json());
  }

  // Buyer: Book & Pay
  async function handleBookAndPay(tanker: any) {
    const checkoutRes = await fetch('/api/bookings/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyerId: activeUser.id,
        tankerId: tanker.id,
        buyerAddress,
        lat: selectedHub.lat,
        lng: selectedHub.lng,
      }),
    });
    const checkoutData = await checkoutRes.json();
    if (!checkoutRes.ok) {
      alert(checkoutData.error);
      return;
    }

    // Confirm payment (triggers escrow hold & dispatches tanker)
    const confirmRes = await fetch(`/api/bookings/${checkoutData.booking.id}/confirm-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDemo: true }),
    });
    const confirmData = await confirmRes.json();
    if (confirmRes.ok) {
      setStatusBanner(
        `Paid ₹${tanker.total_inr}! Tanker ${tanker.vehicle_number} dispatched. Share Delivery OTP: ${confirmData.deliveryOtp}`
      );
      searchTankers();
      fetchBookings();
    }
  }

  // Verify Delivery OTP -> Releases 90% to Seller, 10% to Platform
  async function handleCompleteDelivery(bookingId: string) {
    const otp = otpInputs[bookingId];
    const res = await fetch(`/api/bookings/${bookingId}/complete-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      return;
    }
    setStatusBanner(data.message);
    fetchBookings();
    if (activeUser.role === 'BUYER') searchTankers();
    else fetchSellerFleet();
  }

  // Seller: Add Tanker
  async function handleAddTanker(e: React.FormEvent) {
    e.preventDefault();
    const hub = BENGALURU_HUBS[tankerForm.hubIndex];
    const res = await fetch('/api/sellers/tankers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellerId: activeUser.id,
        vehicleNumber: tankerForm.vehicleNumber,
        areaName: hub.name,
        capacityLiters: tankerForm.capacityLiters,
        waterType: tankerForm.waterType,
        hoseLengthFt: tankerForm.hoseLengthFt,
        lat: hub.lat,
        lng: hub.lng,
        radiusKm: tankerForm.radiusKm,
        basePriceInr: tankerForm.basePriceInr,
        perKmInr: tankerForm.perKmInr,
      }),
    });
    if (res.ok) {
      setTankerForm({ ...tankerForm, vehicleNumber: '' });
      setStatusBanner('New water tanker registered and live on the Bengaluru map!');
      fetchSellerFleet();
    } else {
      const err = await res.json();
      alert(err.error);
    }
  }

  async function toggleTankerAvailability(tankerId: string) {
    await fetch(`/api/tankers/${tankerId}/toggle`, { method: 'PATCH' });
    fetchSellerFleet();
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Header */}
      <header className="bg-sky-900 text-white shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Droplets className="w-8 h-8 text-sky-300" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">WaterManagement Bengaluru</h1>
              <p className="text-xs text-sky-200">Verified Tanker Marketplace • 90/10 Escrow Split</p>
            </div>
          </div>

          {/* Demo Account Switcher */}
          <div className="flex items-center gap-3 bg-sky-950/60 px-3 py-2 rounded-lg border border-sky-700">
            <span className="text-xs text-sky-300 font-medium">Active Account:</span>
            <select
              className="bg-sky-900 text-white text-sm rounded px-2 py-1 border border-sky-600"
              value={activeUser?.id || ''}
              onChange={(e) => {
                const found = users.find((u) => u.id === e.target.value);
                if (found) setActiveUser(found);
              }}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Notification Banner */}
      {statusBanner && (
        <div className="bg-emerald-600 text-white px-4 py-2.5 text-sm font-medium">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <span>{statusBanner}</span>
            <button onClick={() => setStatusBanner(null)} className="underline text-xs">
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="max-w-6xl w-full mx-auto px-4 py-6 space-y-8 flex-1">
        {/* Quick User Registration Bar */}
        <section className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <form onSubmit={handleRegisterUser} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Register New User</label>
              <input
                required
                placeholder="Full Name / Apartment / Agency"
                className="border rounded-lg px-3 py-1.5 text-sm w-56"
                value={newUserForm.name}
                onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Phone</label>
              <input
                required
                placeholder="98800XXXXX"
                className="border rounded-lg px-3 py-1.5 text-sm w-40"
                value={newUserForm.phone}
                onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Role</label>
              <select
                className="border rounded-lg px-3 py-1.5 text-sm"
                value={newUserForm.role}
                onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
              >
                <option value="BUYER">Buyer (Order Water)</option>
                <option value="SELLER">Seller (Tanker Owner)</option>
              </select>
            </div>
            <button
              type="submit"
              className="bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium px-4 py-1.5 rounded-lg"
            >
              Register & Switch
            </button>
          </form>
        </section>

        {/* ================= BUYER VIEW ================= */}
        {activeUser?.role === 'BUYER' && (
          <>
            {/* Location & Filter Controls */}
            <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <div className="flex items-center gap-2 text-sky-900 font-bold text-lg">
                <MapPin className="w-5 h-5 text-sky-600" />
                <h2>Set Delivery Location in Bengaluru</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Region / Locality</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-slate-50"
                    value={selectedHub.name}
                    onChange={(e) => {
                      const hub = BENGALURU_HUBS.find((h) => h.name === e.target.value);
                      if (hub) setSelectedHub(hub);
                    }}
                  >
                    {BENGALURU_HUBS.map((hub) => (
                      <option key={hub.name} value={hub.name}>
                        {hub.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Apartment / Sump Address</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={buyerAddress}
                    onChange={(e) => setBuyerAddress(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Water Category</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-slate-50"
                    value={waterFilter}
                    onChange={(e) => setWaterFilter(e.target.value)}
                  >
                    <option value="ALL">All Water Types</option>
                    <option value="POTABLE">Potable / Borewell (Domestic)</option>
                    <option value="TREATED">Secondary Treated (Construction/Flushing)</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Available Tankers Grid */}
            <section className="space-y-3">
              <h3 className="text-lg font-bold text-slate-800">
                Available Tankers Near {selectedHub.name} ({tankers.length})
              </h3>

              {tankers.length === 0 ? (
                <div className="bg-white p-8 rounded-xl border text-center text-slate-500">
                  No available tankers cover {selectedHub.name} right now. Try switching to Whitefield or Sarjapur Road, or register a tanker in Seller mode.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {tankers.map((t) => (
                    <div key={t.id} className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 flex flex-col justify-between space-y-4">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <span
                            className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                              t.water_type === 'POTABLE'
                                ? 'bg-sky-100 text-sky-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {t.water_type}
                          </span>
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <Navigation className="w-3.5 h-3.5" /> {t.distance_km} km away
                          </span>
                        </div>

                        <h4 className="font-bold text-lg text-slate-900">
                          {t.capacity_liters.toLocaleString()} Liters Tanker
                        </h4>
                        <p className="text-sm text-slate-600">{t.seller_name}</p>
                        <p className="text-xs text-slate-500">
                          Vehicle: <span className="font-mono font-semibold">{t.vehicle_number}</span> • Pipe: {t.hose_length_ft} ft
                        </p>
                      </div>

                      <div className="pt-3 border-t space-y-3">
                        <div className="flex justify-between items-baseline">
                          <span className="text-xs text-slate-500">Total Delivered Price</span>
                          <span className="text-2xl font-extrabold text-slate-900">₹{t.total_inr}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 bg-slate-50 p-2 rounded flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>Escrow protected: ₹{t.seller_payout_inr} to owner on OTP, ₹{t.platform_fee_inr} (10%) platform fee.</span>
                        </div>
                        <button
                          onClick={() => handleBookAndPay(t)}
                          className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-2.5 rounded-lg text-sm transition"
                        >
                          Pay ₹{t.total_inr} & Book Tanker
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* ================= SELLER VIEW ================= */}
        {activeUser?.role === 'SELLER' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Register Tanker Form */}
            <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <div className="flex items-center gap-2 text-sky-900 font-bold text-lg">
                <PlusCircle className="w-5 h-5 text-sky-600" />
                <h2>Register Water Tanker</h2>
              </div>

              <form onSubmit={handleAddTanker} className="space-y-3 text-sm">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Vehicle Registration No.</label>
                  <input
                    required
                    placeholder="KA-53-MN-1234"
                    className="w-full border rounded-lg px-3 py-2"
                    value={tankerForm.vehicleNumber}
                    onChange={(e) => setTankerForm({ ...tankerForm, vehicleNumber: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Base Filling Area</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={tankerForm.hubIndex}
                    onChange={(e) => setTankerForm({ ...tankerForm, hubIndex: Number(e.target.value) })}
                  >
                    {BENGALURU_HUBS.map((h, i) => (
                      <option key={h.name} value={i}>{h.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Capacity (L)</label>
                    <select
                      className="w-full border rounded-lg px-3 py-2"
                      value={tankerForm.capacityLiters}
                      onChange={(e) => setTankerForm({ ...tankerForm, capacityLiters: Number(e.target.value) })}
                    >
                      <option value={6000}>6,000 L</option>
                      <option value={8000}>8,000 L</option>
                      <option value={12000}>12,000 L</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Water Type</label>
                    <select
                      className="w-full border rounded-lg px-3 py-2"
                      value={tankerForm.waterType}
                      onChange={(e) => setTankerForm({ ...tankerForm, waterType: e.target.value })}
                    >
                      <option value="POTABLE">Potable</option>
                      <option value="TREATED">Treated</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Base Price (₹ / 5km)</label>
                    <input
                      type="number"
                      required
                      className="w-full border rounded-lg px-3 py-2"
                      value={tankerForm.basePriceInr}
                      onChange={(e) => setTankerForm({ ...tankerForm, basePriceInr: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Extra ₹ / km</label>
                    <input
                      type="number"
                      required
                      className="w-full border rounded-lg px-3 py-2"
                      value={tankerForm.perKmInr}
                      onChange={(e) => setTankerForm({ ...tankerForm, perKmInr: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Max Service Radius (km)</label>
                  <input
                    type="number"
                    required
                    className="w-full border rounded-lg px-3 py-2"
                    value={tankerForm.radiusKm}
                    onChange={(e) => setTankerForm({ ...tankerForm, radiusKm: Number(e.target.value) })}
                  />
                </div>

                <p className="text-xs text-slate-500 bg-amber-50 p-2.5 rounded border border-amber-200">
                  Platform commission is <strong>10%</strong> per completed trip. You receive <strong>90%</strong> directly to your linked bank account upon delivery OTP verification.
                </p>

                <button
                  type="submit"
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-2.5 rounded-lg"
                >
                  Add Tanker to Marketplace
                </button>
              </form>
            </section>

            {/* Seller Active Fleet */}
            <section className="lg:col-span-2 space-y-4">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-lg">
                <Truck className="w-5 h-5 text-sky-600" />
                <h2>Your Registered Fleet ({sellerFleet.length})</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sellerFleet.map((t) => (
                  <div key={t.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-slate-900">{t.vehicle_number}</span>
                      <button
                        onClick={() => toggleTankerAvailability(t.id)}
                        className={`text-xs font-bold px-3 py-1 rounded-full ${
                          t.is_available
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {t.is_available ? 'Available (Click to Pause)' : 'Busy / Offline'}
                      </button>
                    </div>
                    <p className="text-sm text-slate-600">
                      {t.area_name} • {t.capacity_liters}L ({t.water_type})
                    </p>
                    <p className="text-xs text-slate-500">
                      Base: ₹{Number(t.base_price_paise) / 100} • Extra: ₹{Number(t.per_km_paise) / 100}/km • Radius: {t.max_radius_meters / 1000} km
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ================= ORDERS & ESCROW LEDGER (BOTH ROLES) ================= */}
        <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-lg">
            <IndianRupee className="w-5 h-5 text-emerald-600" />
            <h2>Bookings & 90/10 Escrow Settlement Tracker</h2>
          </div>

          {bookings.length === 0 ? (
            <p className="text-sm text-slate-500">No bookings yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b text-xs uppercase text-slate-500">
                    <th className="py-2">Tanker</th>
                    <th className="py-2">Delivery Address</th>
                    <th className="py-2">Total Paid</th>
                    <th className="py-2">Seller Share (90%)</th>
                    <th className="py-2">Platform Fee (10%)</th>
                    <th className="py-2">Status / Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bookings.map((b) => (
                    <tr key={b.id}>
                      <td className="py-3 font-medium">
                        {b.vehicle_number} ({b.capacity_liters}L)
                      </td>
                      <td className="py-3 text-slate-600 max-w-xs truncate">{b.buyer_address}</td>
                      <td className="py-3 font-bold">₹{Number(b.total_amount_paise) / 100}</td>
                      <td className="py-3 text-emerald-700 font-semibold">
                        ₹{Number(b.seller_payout_paise) / 100}
                      </td>
                      <td className="py-3 text-sky-700 font-semibold">
                        ₹{Number(b.platform_fee_paise) / 100}
                      </td>
                      <td className="py-3">
                        {b.status === 'CONFIRMED' ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {activeUser.role === 'BUYER' && (
                              <span className="text-xs bg-amber-100 text-amber-900 font-mono font-bold px-2 py-1 rounded">
                                OTP: {b.delivery_otp}
                              </span>
                            )}
                            <input
                              placeholder="Enter OTP"
                              maxLength={4}
                              className="border rounded px-2 py-1 text-xs w-20 font-mono"
                              value={otpInputs[b.id] || ''}
                              onChange={(e) => setOtpInputs({ ...otpInputs, [b.id]: e.target.value })}
                            />
                            <button
                              onClick={() => handleCompleteDelivery(b.id)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-2.5 py-1 rounded"
                            >
                              Verify & Release Payout
                            </button>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5" /> {b.status}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
