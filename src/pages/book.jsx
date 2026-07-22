import React from 'react';
import BookingWidget from '../src/components/BookingWidget'; // Adjust import path if needed

export default function BookPage() {
  const handleBookingSubmit = async (bookingData) => {
    try {
      const response = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingData),
      });

      const result = await response.json();

      if (result.success) {
        alert('🎉 Booking confirmed! Thank you for choosing Have Us Clean.');
      } else {
        alert('Error submitting booking: ' + result.error);
      }
    } catch (err) {
      console.error('Submission error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 py-10 px-4 flex flex-col items-center justify-center">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-white">Book Your Cleaning Service</h1>
        <p className="text-slate-400 text-sm mt-2">Instant estimates & secure booking in under 60 seconds.</p>
      </div>

      <BookingWidget onBookingSubmit={handleBookingSubmit} />
    </div>
  );
}
