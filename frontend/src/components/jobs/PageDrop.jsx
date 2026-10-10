import React, { useEffect, useRef, useState } from 'react';
import { navigate } from '../../router';
import { addDroppedFiles } from './uploadQueue';

const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

/**
 * Files dropped anywhere on the page → onFiles(FileList). Returns whether a
 * file drag is over the page, for <DropWash />. Listens on document, which
 * a drag event reaches before window: App's window-level refusal of drops
 * would otherwise come first on a screen mounted after it.
 */
export function usePageFileDrop(onFiles) {
  const [dragging, setDragging] = useState(false);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  // An enter/leave counter keeps the wash steady while the drag crosses
  // child elements; anything that ends a drag without balancing it (drop,
  // dragend, leaving the window, switching apps) resets.
  useEffect(() => {
    let depth = 0;
    let leaveTimer = 0;
    const reset = () => {
      clearTimeout(leaveTimer);
      depth = 0;
      setDragging(false);
    };
    const onEnter = (e) => {
      if (!isFileDrag(e)) return;
      clearTimeout(leaveTimer);
      depth += 1;
      setDragging(true);
    };
    const onLeave = (e) => {
      if (!isFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
      // No element to go to: the drag left the window, whatever the counter
      // says (an element removed mid-drag never sends its dragleave). Safari
      // leaves relatedTarget null on every dragleave, so wait for the
      // dragover that follows when the drag is still on the page.
      else if (e.relatedTarget === null) {
        clearTimeout(leaveTimer);
        leaveTimer = setTimeout(reset, 300);
      }
    };
    const onOver = (e) => {
      if (!isFileDrag(e)) return;
      clearTimeout(leaveTimer);
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e) => {
      if (!isFileDrag(e) || e.defaultPrevented) return;
      e.preventDefault();
      reset();
      onFilesRef.current(e.dataTransfer.files);
    };
    document.addEventListener('dragenter', onEnter);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('dragover', onOver);
    document.addEventListener('drop', onDrop);
    document.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      clearTimeout(leaveTimer);
      document.removeEventListener('dragenter', onEnter);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return dragging;
}

/** The whole-page "drop to add" wash shown while files are dragged over. */
export function DropWash() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center gap-1 bg-wash/95"
    >
      <p className="m-0 text-h3">Drop to add audio files</p>
      <p className="m-0 text-caption text-muted">Each file becomes its own job.</p>
    </div>
  );
}

/**
 * A job page takes dropped files too: they join the new-split queue and
 * the Split home opens, with the list, the settings and the Split button
 * (it reports skipped files, as for a drop there).
 */
export function DropToNewSplit() {
  const dragging = usePageFileDrop((fileList) => {
    if (!fileList?.length) return;
    addDroppedFiles(fileList).then(() => navigate('/split'));
  });
  return dragging ? <DropWash /> : null;
}
