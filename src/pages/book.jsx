import React, { useState } from 'react';
import BookingWidget from '../components/BookingWidget';

export default function BookPage() {
  const [status, setStatus] = useState('');

  const handleBookingSubmit = async (bookingData) => {
    setStatus('Submitting your request…');
    try {
      const response = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingData }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'We could not submit your request. Please try again.');
      }

      setStatus('Your cleaning request is in. Our team will contact you to confirm the appointment.');
    } catch (err) {
      console.error('Booking submission failed', err);
      setStatus(err instanceof Error ? err.message : 'We could not submit your request. Please try again.');
    }
  };

  return (
    <main className="booking-page" data-public-booking="true">
      <header className="booking-header">
        <a className="booking-brand" href="https://haveusclean.ca" aria-label="Have Us Clean home">
          <span className="booking-brand__mark" aria-hidden="true">H</span><span>Have Us Clean</span>
        </a>
        <span className="booking-header__help">Need help? <a href="mailto:haveusclean@gmail.com">Contact us</a></span>
      </header>
      <section className="booking-hero">
        <span className="booking-kicker">A cleaner home, thoughtfully arranged</span>
        <h1>Book your cleaning in a few simple steps.</h1>
        <p>No account required. Get a governed residential estimate or request a commercial facility walkthrough.</p>
      </section>
      <BookingWidget onBookingSubmit={handleBookingSubmit} />
      {status ? <p role="status" className="booking-page-status">{status}</p> : null}
    </main>
  );
}
