import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { isComposing } from '../../keys';
import { errorMessage, importSample, updateSample } from '../../samplesApi';
import TextButton from '../TextButton';
import { TagDatalist, parseTags } from './TagEditor';
import { COARSE, TOUCH_TEXT } from './ui';

let nextId = 1;
const stem = (file) => file.name.replace(/\.[^.]+$/, '');

/**
 * Sequential import queue (P6): any number of files, one upload at a time
 * with byte progress, then the server's conversion. Optional tags apply to
 * the whole batch - typed while it runs, they also reach files already in.
 */
export function useImportQueue({ onImported, onPatched, onDrained }) {
  const [items, setItems] = useState([]);
  const [batchTags, setBatchTagsState] = useState([]);
  const tagsRef = useRef([]);
  const controllers = useRef(new Map());
  const cb = useRef({ onImported, onPatched, onDrained });
  cb.current = { onImported, onPatched, onDrained };

  const update = (id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const addFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setItems((prev) => [
      ...prev,
      ...files.map((file) => ({ id: nextId++, file, name: '', status: 'queued', progress: 0, error: null, sample: null })),
    ]);
  }, []);

  const active = items.find((it) => it.status === 'uploading' || it.status === 'processing');
  const next = !active && items.find((it) => it.status === 'queued');

  useEffect(() => {
    if (!next) return;
    const item = next;
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    update(item.id, { status: 'uploading', progress: 0 });
    importSample({
      file: item.file,
      name: item.name.trim() || undefined,
      tags: tagsRef.current,
      signal: controller.signal,
      onProgress: ({ loaded, total }) => {
        const progress = total ? loaded / total : 0;
        update(item.id, progress >= 1 ? { progress: 1, status: 'processing' } : { progress });
      },
    })
      .then((res) => {
        update(item.id, { status: 'done', progress: 1, sample: res.data });
        cb.current.onImported?.(res.data);
      })
      .catch((err) => {
        if (controller.signal.aborted) update(item.id, { status: 'cancelled' });
        else update(item.id, { status: 'failed', error: errorMessage(err, 'Import failed') });
      })
      .finally(() => controllers.current.delete(item.id));
  }, [next]); // eslint-disable-line react-hooks/exhaustive-deps

  // The queue just emptied: one refresh for everything that came in.
  const busy = items.some((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing');
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) cb.current.onDrained?.();
    wasBusy.current = busy;
  }, [busy]);

  const cancel = useCallback((id) => {
    const c = controllers.current.get(id);
    if (c) c.abort();
    else setItems((prev) => prev.map((it) => (it.id === id && it.status === 'queued' ? { ...it, status: 'cancelled' } : it)));
  }, []);

  const rename = useCallback((id, name) => update(id, { name }), []);

  // Back into the queue (the server was busy, the network dropped...).
  const retry = useCallback((id) => update(id, { status: 'queued', progress: 0, error: null }), []);

  const clear = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing'));
  }, []);

  const setBatchTags = useCallback(
    async (tags) => {
      tagsRef.current = tags;
      setBatchTagsState(tags);
      if (!tags.length) return;
      // files that already landed get them too
      for (const it of items) {
        if (it.status !== 'done' || !it.sample) continue;
        const merged = [...new Set([...(it.sample.tags || []), ...tags])];
        if (merged.length === (it.sample.tags || []).length) continue;
        try {
          const res = await updateSample(it.sample.id, { tags: merged });
          update(it.id, { sample: res.data });
          cb.current.onPatched?.(res.data);
        } catch (err) {
          update(it.id, { error: errorMessage(err, 'Could not tag it') });
        }
      }
    },
    [items]
  );

  return { items, busy, addFiles, cancel, rename, retry, clear, batchTags, setBatchTags };
}

const STATUS_TEXT = {
  queued: 'Waiting',
  processing: 'Converting…',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** The queue, in flow under the toolbar while there's anything in it. */
export function ImportPanel({ queue, allTags }) {
  const { items, busy, cancel, rename, retry, clear, batchTags, setBatchTags } = queue;
  const [tagDraft, setTagDraft] = useState('');
  const listId = useId();
  if (!items.length) return null;
  const done = items.filter((it) => it.status === 'done').length;
  const position = items.findIndex((it) => it.status === 'uploading' || it.status === 'processing') + 1;

  const commitTags = () => {
    const tags = parseTags(tagDraft);
    if (tags.join(',') !== batchTags.join(',')) setBatchTags(tags);
  };

  return (
    <section aria-label="Import" className="border-b border-line py-2">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <h3 className="m-0 text-h4 font-light" aria-live="polite">
          {busy ? `Importing ${position || done + 1} of ${items.length}` : `Imported ${done} of ${items.length}`}
        </h3>
        <label className="flex min-w-0 items-baseline gap-2 text-caption">
          <span className="text-muted">Tags for these</span>
          <input
            type="text"
            value={tagDraft}
            list={listId}
            onChange={(e) => setTagDraft(e.target.value)}
            onBlur={commitTags}
            onKeyDown={(e) => {
              e.stopPropagation();
              // the Enter that ends an IME composition isn't a commit
              if (e.key === 'Enter' && !isComposing(e)) commitTags();
            }}
            placeholder="optional"
            className={`ainput w-48 !pb-0.5 ${TOUCH_TEXT}`}
          />
          <TagDatalist id={listId} tags={allTags} />
        </label>
        {!busy && (
          <TextButton muted onClick={clear} className={`ml-auto ${COARSE}`}>
            Dismiss
          </TextButton>
        )}
      </div>
      <ul className="m-0 mt-1 list-none p-0">
        {items.map((it) => (
          <li key={it.id} className="flex min-h-8 flex-wrap items-center gap-x-3 text-caption coarse:min-h-11">
            {it.status === 'queued' ? (
              <input
                type="text"
                value={it.name}
                onChange={(e) => rename(it.id, e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={stem(it.file)}
                aria-label={`Name for ${it.file.name} (optional)`}
                className={`ainput w-56 min-w-0 !pb-0.5 ${TOUCH_TEXT}`}
              />
            ) : (
              <span className="w-56 min-w-0 truncate" title={it.file.name}>
                {it.sample?.name || it.name || stem(it.file)}
              </span>
            )}
            <span className="relative h-px min-w-[3rem] flex-1 bg-line" aria-hidden="true">
              <span
                className="absolute inset-y-0 left-0 bg-ink"
                style={{ width: `${Math.round((it.status === 'done' ? 1 : it.progress) * 100)}%` }}
              />
            </span>
            <span className={`w-28 shrink-0 truncate text-right tabular-nums ${it.status === 'failed' ? '' : 'text-muted'}`}>
              {it.status === 'uploading' ? `${Math.round(it.progress * 100)}%` : it.status === 'failed' ? 'Failed' : STATUS_TEXT[it.status]}
            </span>
            {it.status === 'queued' || it.status === 'uploading' ? (
              <button
                type="button"
                onClick={() => cancel(it.id)}
                aria-label={`Cancel ${it.file.name}`}
                title="Cancel"
                className={`link h-6 w-6 shrink-0 justify-center ${COARSE}`}
              >
                <FiX className="icon" strokeWidth={1.5} aria-hidden="true" />
              </button>
            ) : it.status === 'failed' ? (
              <TextButton onClick={() => retry(it.id)} aria-label={`Retry ${it.file.name}`} className={`shrink-0 ${COARSE}`}>
                Retry
              </TextButton>
            ) : (
              <span className="h-6 w-6 shrink-0 coarse:w-11" />
            )}
            {/* its own line, not a truncated tooltip: touch has no hover */}
            {it.error && (
              <span role="alert" className="basis-full pb-1">
                {it.error}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Whole-window drop target (only for drags that carry files). */
export function useFileDrop(onFiles) {
  const [over, setOver] = useState(false);
  const cbRef = useRef(onFiles);
  cbRef.current = onFiles;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setOver(true);
    };
    const onOver = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // without this the browser opens the file
      e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      cbRef.current(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return over;
}

export function DropVeil() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-paper/90" aria-hidden="true">
      <p className="m-0 text-h3 font-light">Drop audio files to import</p>
    </div>
  );
}
