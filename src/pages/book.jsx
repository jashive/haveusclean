import React, { useState } from 'react';
import BookingWidget from '../components/BookingWidget';

export default function BookPage() {
  const [status, setStatus] = useState('');

  const handleBookingSubmit = async (bookingData) => {
    setStatus('Submitting…');
    try {
      const response = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingData }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Booking submission failed.');
      }

      setStatus(`Residential booking received. Reference: ${result.serviceRequestId || result.bookingId || result.job?.id || 'pending'}`);
    } catch (err) {
      console.error('Submission error:', err);
      setStatus(err instanceof Error ? err.message : 'Unable to submit booking.');
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 py-10 px-4 flex flex-col items-center justify-center" data-public-booking="true">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-white">Request Cleaning Service</h1>
        <p className="text-slate-400 text-sm mt-2">No account required. Residential customers can receive a governed estimate. Commercial facilities request an on-site walkthrough for a custom proposal.</p>
      </div>

      <BookingWidget onBookingSubmit={handleBookingSubmit} />
      {status ? <p role="status" className="text-slate-200 text-sm mt-4">{status}</p> : null}
    </main>
  );
}
