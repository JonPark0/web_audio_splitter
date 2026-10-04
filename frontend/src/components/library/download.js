// Saving files with the names the library chooses.

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Click handler for a same-origin download link that must keep the
 * `download` name: the server's Content-Disposition filename (the bare
 * sample name) would otherwise win over the attribute, and the BPM/key in
 * "<name>_<bpm>bpm_<key>.wav" would be lost. Fetches into a blob instead;
 * modified clicks (new tab, copy) keep the plain link.
 */
export function downloadAsNamed(e, url, name) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.blob();
    })
    .then((blob) => saveBlob(blob, name))
    .catch(() => {
      // fall back to a plain download (server's name) rather than nothing
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
}
