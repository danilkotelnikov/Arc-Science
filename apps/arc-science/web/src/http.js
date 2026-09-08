export async function checkedFetch(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let detail = '';
    try { const data = await response.json(); detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || ''); } catch { /* HTTP status remains actionable. */ }
    throw new Error(`Request failed (${response.status})${detail ? ': ' + detail : ''}`);
  }
  return response;
}

export async function downloadResponse(response, filename) {
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
