// Saving files with the names the library chooses.

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Generous: iOS asks "Download?" first, and the URL must outlive that.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// The last download started, so a double tap doesn't save the file twice.
let last = { url: '', at: 0 };
const REPEAT_MS = 2000;

/**
 * Click handler for a sample's audio link that saves it as `name`
 * ("<name>_<bpm>bpm_<key>.wav"): the server's own Content-Disposition name
 * (the bare sample name) would win over the `download` attribute, so the
 * click goes to the same URL with ?download=<name>, which the server sends
 * as an attachment under that name. A plain link: the browser streams it to
 * disk (iOS Safari and other mobile browsers too), with its own progress.
 * Modified clicks (new tab, copy) keep the plain, playable link.
 */
export function downloadAsNamed(e, url, name) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const target = `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`;
  const now = Date.now();
  if (last.url === target && now - last.at < REPEAT_MS) return;
  last = { url: target, at: now };
  const a = document.createElement('a');
  a.href = target;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
