export async function sendNativeQuoteEmail({ quoteVersionId, accessToken }) {
  if (!quoteVersionId) throw new Error('Quote version is required.');
  if (!accessToken) throw new Error('ServiceOS authentication is required.');

  const response = await fetch('/api/notifications?action=quote-email', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ quoteVersionId }),
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok || !data?.success) throw new Error(data?.error || 'Unable to send quote email.');
  return data;
}
