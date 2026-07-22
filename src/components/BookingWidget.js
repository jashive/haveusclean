import React, { useState, useMemo } from 'react';

// Pricing Configurations
const PRICING_CONFIG = {
  basePrice: 99,
  perBed: 25,
  perBath: 35,
  frequencies: [
    { id: 'one-time', label: 'One-Time', discount: 0 },
    { id: 'weekly', label: 'Weekly', discount: 0.20, badge: 'Save 20%' },
    { id: 'bi-weekly', label: 'Bi-Weekly', discount: 0.15, badge: 'Save 15%' },
    { id: 'monthly', label: 'Monthly', discount: 0.10, badge: 'Save 10%' },
  ],
  addOns: [
    { id: 'oven', label: 'Inside Oven', price: 35, icon: '🍳' },
    { id: 'fridge', label: 'Inside Fridge', price: 30, icon: '🧊' },
    { id: 'windows', label: 'Interior Windows', price: 45, icon: '🪟' },
    { id: 'deep-clean', label: 'Deep Clean Upgrade', price: 65, icon: '✨' },
    { id: 'move-in', label: 'Move-In/Move-Out', price: 85, icon: '📦' },
  ],
};

export default function BookingWidget({ onBookingSubmit }) {
  const [step, setStep] = useState(1);
  const [bedrooms, setBedrooms] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  const [frequency, setFrequency] = useState('bi-weekly');
  const [selectedAddOns, setSelectedAddOns] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTimeSlot, setSelectedTimeSlot] = useState('');
  
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    address: '',
    notes: '',
  });

  // Calculate Subtotal & Discount dynamically
  const priceSummary = useMemo(() => {
    let subtotal = PRICING_CONFIG.basePrice;
    subtotal += Math.max(0, bedrooms - 1) * PRICING_CONFIG.perBed;
    subtotal += Math.max(0, bathrooms - 1) * PRICING_CONFIG.perBath;

    const addOnTotal = selectedAddOns.reduce((sum, addOnId) => {
      const item = PRICING_CONFIG.addOns.find((a) => a.id === addOnId);
      return sum + (item ? item.price : 0);
    }, 0);

    const grossTotal = subtotal + addOnTotal;
    const selectedFreq = PRICING_CONFIG.frequencies.find((f) => f.id === frequency);
    const discountAmount = grossTotal * (selectedFreq?.discount || 0);
    const finalTotal = grossTotal - discountAmount;

    return { grossTotal, discountAmount, finalTotal };
  }, [bedrooms, bathrooms, selectedAddOns, frequency]);

  const toggleAddOn = (id) => {
    setSelectedAddOns((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div className="max-w-4xl mx-auto bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col md:flex-row">
      
      {/* Left Column: Interactive Form */}
      <div className="flex-1 p-6 md:p-8 border-b md:border-b-0 md:border-r border-slate-800">
        
        {/* Step Indicator */}
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-400 mb-6 uppercase tracking-wider">
          <span className={step === 1 ? 'text-cyan-400' : ''}>1. Service</span>
          <span>&gt;</span>
          <span className={step === 2 ? 'text-cyan-400' : ''}>2. Schedule & Contact</span>
        </div>

        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold">Customize Your Clean</h2>

            {/* Bedrooms & Bathrooms */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">Bedrooms</label>
                <div className="flex items-center space-x-3 bg-slate-800 p-2 rounded-lg justify-between">
                  <button 
                    onClick={() => setBedrooms(Math.max(1, bedrooms - 1))}
                    className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 font-bold"
                  >-</button>
                  <span className="font-bold">{bedrooms}</span>
                  <button 
                    onClick={() => setBedrooms(bedrooms + 1)}
                    className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 font-bold"
                  >+</button>
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-2">Bathrooms</label>
                <div className="flex items-center space-x-3 bg-slate-800 p-2 rounded-lg justify-between">
                  <button 
                    onClick={() => setBathrooms(Math.max(1, bathrooms - 1))}
                    className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 font-bold"
                  >-</button>
                  <span className="font-bold">{bathrooms}</span>
                  <button 
                    onClick={() => setBathrooms(bathrooms + 0.5)}
                    className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 font-bold"
                  >+</button>
                </div>
              </div>
            </div>

            {/* Frequency Selector */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Cleaning Frequency</label>
              <div className="grid grid-cols-2 gap-2">
                {PRICING_CONFIG.frequencies.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFrequency(f.id)}
                    className={`p-3 rounded-lg border text-left flex flex-col justify-between transition-all ${
                      frequency === f.id
                        ? 'border-cyan-500 bg-cyan-950/30 text-white'
                        : 'border-slate-800 bg-slate-800/50 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-medium text-sm">{f.label}</span>
                    {f.badge && (
                      <span className="text-[10px] text-cyan-400 font-semibold mt-1">
                        {f.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Extra Add-Ons */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Select Add-Ons</label>
              <div className="grid grid-cols-2 gap-2">
                {PRICING_CONFIG.addOns.map((addon) => {
                  const isSelected = selectedAddOns.includes(addon.id);
                  return (
                    <button
                      key={addon.id}
                      onClick={() => toggleAddOn(addon.id)}
                      className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${
                        isSelected
                          ? 'border-cyan-500 bg-cyan-950/30 text-white'
                          : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <span>{addon.icon} {addon.label}</span>
                      <span className="font-semibold text-slate-300">+${addon.price}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg transition-all"
            >
              Continue to Schedule &rarr;
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Details & Schedule</h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Date</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Time Slot</label>
                <select
                  value={selectedTimeSlot}
                  onChange={(e) => setSelectedTimeSlot(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="">Select Window</option>
                  <option value="8am-11am">Morning (8 AM - 11 AM)</option>
                  <option value="11am-2pm">Midday (11 AM - 2 PM)</option>
                  <option value="2pm-5pm">Afternoon (2 PM - 5 PM)</option>
                </select>
              </div>
            </div>

            <input
              type="text"
              name="fullName"
              placeholder="Full Name"
              value={formData.fullName}
              onChange={handleInputChange}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="email"
                name="email"
                placeholder="Email Address"
                value={formData.email}
                onChange={handleInputChange}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
              />
              <input
                type="tel"
                name="phone"
                placeholder="Phone Number"
                value={formData.phone}
                onChange={handleInputChange}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
            <input
              type="text"
              name="address"
              placeholder="Service Address"
              value={formData.address}
              onChange={handleInputChange}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
            />

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-lg"
              >
                Back
              </button>
              <button
                onClick={() => onBookingSubmit && onBookingSubmit({ ...formData, bedrooms, bathrooms, frequency, selectedAddOns, selectedDate, selectedTimeSlot, priceSummary })}
                className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg transition-all"
              >
                Confirm & Pay (${priceSummary.finalTotal.toFixed(2)})
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Right Column: Dynamic Price Summary Card */}
      <div className="w-full md:w-80 bg-slate-950 p-6 md:p-8 flex flex-col justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-200 mb-4 border-b border-slate-800 pb-2">
            Booking Summary
          </h3>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>{bedrooms} Bed, {bathrooms} Bath</span>
              <span className="text-white font-medium">${PRICING_CONFIG.basePrice + (bedrooms-1)*25 + (bathrooms-1)*35}</span>
            </div>

            {selectedAddOns.length > 0 && (
              <div className="text-xs text-slate-400 space-y-1 pl-2 border-l border-slate-800">
                {selectedAddOns.map(id => {
                  const item = PRICING_CONFIG.addOns.find(a => a.id === id);
                  return (
                    <div key={id} className="flex justify-between">
                      <span>+ {item?.label}</span>
                      <span>${item?.price}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {priceSummary.discountAmount > 0 && (
              <div className="flex justify-between text-cyan-400 text-xs font-semibold">
                <span>Recurring Discount</span>
                <span>-${priceSummary.discountAmount.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 border-t border-slate-800 pt-4">
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Total</span>
            <span className="text-3xl font-extrabold text-cyan-400">
              ${priceSummary.finalTotal.toFixed(2)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            Card on file charged only after clean completion.
          </p>
        </div>
      </div>

    </div>
  );
}