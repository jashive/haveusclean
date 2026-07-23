// api/bookings/create.js — Receives widget booking submissions
import Stripe from 'stripe';
import nodemailer from 'nodemailer';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `$${amount.toFixed(2)}`;
}

function getBookingPayload(body) {
  const bookingData = body?.bookingData || body || {};
  return {
    name: bookingData.fullName || bookingData.name || 'New Client',
    email: bookingData.email || '',
    phone: bookingData.phone || '',
    address: bookingData.address || bookingData.serviceAddress || 'Pending Address',
    date: bookingData.selectedDate || bookingData.date || '',
    timeSlot: bookingData.selectedTimeSlot || bookingData.timeSlot || '',
    serviceType: bookingData.serviceType || bookingData.frequency || bookingData.service || 'Full Home Clean',
    selectedAddons: bookingData.selectedAddons || bookingData.selectedAddOns || [],
    totalPrice: Number(bookingData?.priceSummary?.finalTotal ?? bookingData?.totalPrice ?? 0),
    paymentMethodId: bookingData.paymentMethodId,
    customerId: bookingData.customerId,
    bedrooms: bookingData.bedrooms,
    bathrooms: bookingData.bathrooms,
    frequency: bookingData.frequency,
    priceSummary: bookingData.priceSummary,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const booking = getBookingPayload(req.body);

    if (booking.paymentMethodId && booking.customerId) {
      await stripe.paymentMethods.attach(booking.paymentMethodId, { customer: booking.customerId });
      await stripe.customers.update(booking.customerId, {
        invoice_settings: { default_payment_method: booking.paymentMethodId },
      });
    }

    const newJob = {
      id: `JOB-${Date.now()}`,
      client_name: booking.name,
      client_email: booking.email,
      client_phone: booking.phone,
      service_address: booking.address,
      stripe_customer_id: booking.customerId || null,
      scheduled_date: booking.date,
      time_slot: booking.timeSlot,
      bedrooms: booking.bedrooms,
      bathrooms: booking.bathrooms,
      frequency: booking.frequency || booking.serviceType,
      add_ons: booking.selectedAddons || [],
      amount: booking.totalPrice,
      status: 'scheduled',
      payment_status: 'card_on_file',
      created_at: new Date().toISOString(),
    };

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.GOOGLE_EMAIL,
        pass: process.env.GOOGLE_APP_PASSWORD,
      },
    });

    if (process.env.GOOGLE_EMAIL && process.env.GOOGLE_APP_PASSWORD) {
      const clientHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
          <h2 style="color:#0f766e;">Booking Confirmed</h2>
          <p>Hi ${booking.name},</p>
          <p>Your cleaning appointment has been received. Here’s your confirmation summary:</p>
          <ul>
            <li><strong>Service:</strong> ${booking.serviceType}</li>
            <li><strong>Date:</strong> ${booking.date}</li>
            <li><strong>Time:</strong> ${booking.timeSlot}</li>
            <li><strong>Address:</strong> ${booking.address}</li>
            <li><strong>Estimated Total:</strong> ${formatCurrency(booking.totalPrice)}</li>
          </ul>
          <p>We’ll be in touch shortly with any follow-up details.</p>
          <p>Thanks,<br/>Have Us Clean</p>
        </div>
      `;

      const adminHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
          <h2 style="color:#b45309;">New Booking Alert</h2>
          <p>A new booking request has been submitted.</p>
          <ul>
            <li><strong>Name:</strong> ${booking.name}</li>
            <li><strong>Email:</strong> ${booking.email}</li>
            <li><strong>Phone:</strong> ${booking.phone}</li>
            <li><strong>Address:</strong> ${booking.address}</li>
            <li><strong>Date:</strong> ${booking.date}</li>
            <li><strong>Time:</strong> ${booking.timeSlot}</li>
            <li><strong>Service:</strong> ${booking.serviceType}</li>
            <li><strong>Add-ons:</strong> ${(booking.selectedAddons || []).join(', ') || 'None'}</li>
            <li><strong>Total:</strong> ${formatCurrency(booking.totalPrice)}</li>
          </ul>
        </div>
      `;

      await transporter.sendMail({
        from: process.env.GOOGLE_EMAIL,
        to: booking.email,
        subject: 'Your booking is confirmed - Have Us Clean',
        html: clientHtml,
      });

      await transporter.sendMail({
        from: process.env.GOOGLE_EMAIL,
        to: process.env.GOOGLE_EMAIL,
        subject: `New booking from ${booking.name}`,
        html: adminHtml,
      });
    } else {
      console.warn('Google SMTP is not configured. Skipping booking emails.');
    }

    console.log('✅ New Booking Created:', newJob);

    return res.status(200).json({
      success: true,
      message: 'Booking successfully created!',
      job: newJob,
    });
  } catch (error) {
    console.error('Booking API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
