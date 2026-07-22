// api/bookings/create.js — Receives widget booking submissions
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      fullName,
      email,
      phone,
      address,
      bedrooms,
      bathrooms,
      frequency,
      selectedAddOns,
      selectedDate,
      selectedTimeSlot,
      priceSummary,
      paymentMethodId,
      customerId,
    } = req.body;

    // 1. Attach Payment Method to Customer if provided
    if (paymentMethodId && customerId) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    }

    // 2. Format Job Payload for Database
    const newJob = {
      id: `JOB-${Date.now()}`,
      client_name: fullName,
      client_email: email,
      client_phone: phone,
      service_address: address,
      stripe_customer_id: customerId || null,
      scheduled_date: selectedDate,
      time_slot: selectedTimeSlot,
      bedrooms,
      bathrooms,
      frequency,
      add_ons: selectedAddOns || [],
      amount: priceSummary?.finalTotal || 0,
      status: 'scheduled', // 'scheduled', 'in_progress', 'completed'
      payment_status: 'card_on_file',
      created_at: new Date().toISOString(),
    };

    // TODO: Connect your database insertion logic here (e.g., Supabase / Firebase / Postgres)
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
