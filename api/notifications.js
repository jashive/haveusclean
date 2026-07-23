export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { job, channel = 'email', kind = 'scheduled' } = req.body || {};
    const message = `${kind} reminder for ${job?.client || 'client'} - ${job?.type || 'service'}`;
    if (process.env.GOOGLE_EMAIL && process.env.GOOGLE_APP_PASSWORD && job?.email) {
      const nodemailer = (await import('nodemailer')).default;
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: process.env.GOOGLE_EMAIL, pass: process.env.GOOGLE_APP_PASSWORD },
      });
      await transporter.sendMail({
        from: process.env.GOOGLE_EMAIL,
        to: job.email,
        subject: `Have Us Clean ${kind === 'followup' ? 'follow-up' : 'reminder'}`,
        html: `<p>Hi ${job.client || 'there'},</p><p>${message}</p><p>Thanks,<br/>Have Us Clean</p>`,
      });
    }
    return res.status(200).json({ success: true, message, channel });
  } catch (error) {
    console.error('Notification API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
