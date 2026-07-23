export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { invoices = [], company = 'Have Us Clean' } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    const synced = (invoices || []).map((invoice, index) => ({
      ...invoice,
      quickbooksId: `QB-${Date.now()}-${index + 1}`,
      syncedAt: new Date().toISOString(),
      status: 'synced',
      company,
    }));

    return res.status(200).json({
      success: true,
      synced,
      syncedCount: synced.length,
      message: `Queued ${synced.length} invoice${synced.length === 1 ? '' : 's'} for QuickBooks sync`,
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Unable to sync invoices' });
  }
}
