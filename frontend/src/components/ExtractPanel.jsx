import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FiMinus, FiPause, FiPlay, FiPlus } from 'react-icons/fi';
import { createMixSample, createSample, errorDetail } from '../api';
import { isComposing } from '../keys';
import { href } from '../router';
import TextButton from './TextButton';
import WordToggle from './WordToggle';
import Sheet from './result/Sheet';
import { fmtBeats, fmtTime, parseTime, stemLabel } from './result/format';
import { deleteSampleById } from './result/samples';

export const MIN_SAMPLE_SEC = 0.05; // the backend's MIN_SAMPLE_SECONDS

/** m:ss.mmm field: typed and committed on Enter/blur; ± steppers on touch. */
function TimeField({ label, value, onCommit, active, onFocus, disabled, step, steppers }) {
  const [draft, setDraftState] = useState(null);
  // The blur right after Enter/Escape runs commit before a re-render: it
  // reads the draft from here, so Escape's discarded text isn't committed.
  const draftRef = useRef(null);
  const setDraft = (v) => {
    draftRef.current = v;
    setDraftState(v);
  };
  const clickFocus = useRef(false);
  const commit = () => {
    if (draftRef.current == null) return;
    const t = parseTime(draftRef.current);
    setDraft(null);
    if (t != null) onCommit(t);
  };
  const stepBtn = (sign) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onCommit(value + sign * step)}
      aria-label={`${label} ${sign < 0 ? 'earlier' : 'later'}`}
      className="link h-11 w-11 items-center justify-center"
    >
      {sign < 0 ? <FiMinus className="icon" aria-hidden="true" /> : <FiPlus className="icon" aria-hidden="true" />}
    </button>
  );
  return (
    <label className="flex items-center gap-2">
      <span className={`${steppers ? 'w-9' : ''} ${active ? 'weight-up' : 'text-muted'}`}>{label}</span>
      {steppers && stepBtn(-1)}
      <input
        type="text"
        inputMode="decimal"
        spellCheck={false}
        disabled={disabled}
        value={disabled ? '' : draft ?? fmtTime(value)}
        placeholder="—"
        // Focus selects the whole time so typing replaces it. A click or tap
        // would put the caret back at its mouseup, so that first mouseup is
        // swallowed, and iOS gets a second select once focus has settled.
        onPointerDown={(e) => {
          clickFocus.current = document.activeElement !== e.currentTarget;
        }}
        onMouseUp={(e) => {
          if (clickFocus.current) e.preventDefault();
          clickFocus.current = false;
        }}
        onFocus={(e) => {
          onFocus?.();
          const el = e.currentTarget;
          el.select();
          setTimeout(() => document.activeElement === el && el.select(), 0);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isComposing(e)) {
            commit();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        aria-label={`${label} (m:ss.mmm)`}
        className="ainput rs-input w-[5.75rem] pb-0 tabular-nums"
      />
      {steppers && stepBtn(1)}
    </label>
  );
}

function Toggle({ on, onClick, children, title }) {
  return (
    <TextButton muted current={on} aria-pressed={on} onClick={onClick} title={title} className="rs-hit">
      {children}
    </TextButton>
  );
}

/**
 * Cut the selection into the library — docked under the mixer (desktop and
 * tablet, fixed height so rows never grow) or a full-screen sheet (phone).
 * The selection lives on the waveforms (Mixer owns it); this edits it
 * precisely (typed m:ss.mmm, set at the playhead, steppers), previews it,
 * and saves the stem — or the audible mix with its gains — with fades,
 * normalize, reverse, format and tags. After a save: Open in Library / Undo.
 */
export default function ExtractPanel({
  taskId,
  tracks,
  source,
  onSource,
  selection,
  onSelection,
  activeEdge,
  onActiveEdge,
  bpm,
  snap,
  variantOf,
  gainOf,
  getPlayhead,
  previewing,
  onPreview,
  loopOn,
  onLoop,
  playing,
  onTogglePlay,
  onSaved,
  onRemoved,
  onClose,
  layout = 'docked',
  onHeight,
  viewer,
  viewerTools = null,
  coarse = false,
}) {
  const sheet = layout === 'sheet';
  const rootRef = useRef(null);
  const label = source === 'mix' ? 'mix' : stemLabel(source);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [tags, setTags] = useState('');
  const [tagsTouched, setTagsTouched] = useState(false);
  const [fadeIn, setFadeIn] = useState('3');
  const [fadeOut, setFadeOut] = useState('3');
  const [normalize, setNormalize] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [mono, setMono] = useState(false);
  const [bitDepth, setBitDepth] = useState('');
  const [rate, setRate] = useState('');
  const [step, setStep] = useState('0.01');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [savedKey, setSavedKey] = useState(null);
  const savingRef = useRef(false);

  const start = selection?.start ?? 0;
  const end = selection?.end ?? 0;
  const len = selection ? end - start : 0;
  const tooShort = !!selection && len < MIN_SAMPLE_SEC;

  // Suggested name/tags follow the selection until the user types their own
  // (B6: saving no longer resets a typed name).
  useEffect(() => {
    if (!nameTouched && selection) setName(`${label} ${fmtTime(start).slice(0, -2)}`);
  }, [label, start, selection, nameTouched]);
  useEffect(() => {
    if (!tagsTouched) setTags(label);
  }, [label, tagsTouched]);

  useLayoutEffect(() => {
    if (sheet || !rootRef.current || !onHeight) return undefined;
    const el = rootRef.current;
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    onHeight(el.offsetHeight);
    return () => {
      ro.disconnect();
      onHeight(0);
    };
  }, [sheet, onHeight]);

  const options = () => ({
    tags: tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    snapToZero: snap === 'zero' || undefined,
    reverse: reverse || undefined,
    normalize: normalize || undefined,
    fadeInMs: Math.max(0, Number(fadeIn) || 0),
    fadeOutMs: Math.max(0, Number(fadeOut) || 0),
    bitDepth: bitDepth ? Number(bitDepth) : undefined,
    sampleRate: rate ? Number(rate) : undefined,
    mono: mono || undefined,
  });
  // What a mix save sends for the stems: what you hear right now.
  const mixStems = () => tracks.map((t) => ({ track: t, variant: variantOf(t), gain: Math.round(gainOf(t) * 10000) / 10000 }));
  // A mix is only a duplicate while every stem's level, mute/solo and variant
  // are what was saved.
  const keyFor = (asMix) =>
    JSON.stringify({ asMix, source, s: start.toFixed(4), e: end.toFixed(4), name, o: options(), v: asMix ? mixStems() : variantOf(source) });

  const save = async (asMix) => {
    if (!selection || tooShort || savingRef.current || keyFor(asMix) === savedKey) return;
    savingRef.current = true; // B6: a second Enter while saving is ignored
    setSaving(true);
    setStatus(null);
    const key = keyFor(asMix);
    const sampleName = name.trim() || undefined;
    try {
      const res = asMix
        ? await createMixSample({
            taskId,
            stems: mixStems(),
            startSec: start,
            endSec: end,
            name: sampleName,
            ...options(),
          })
        : await createSample({ taskId, track: source, variant: variantOf(source), startSec: start, endSec: end, name: sampleName, ...options() });
      setSavedKey(key);
      setStatus({ kind: 'saved', sample: res.data });
      onSaved(res.data);
    } catch (e) {
      setStatus({ kind: 'error', text: errorDetail(e, 'Could not save the sample') });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const undo = async (sample) => {
    try {
      await deleteSampleById(sample.id);
      onRemoved(sample.id);
      setSavedKey(null);
      setStatus({ kind: 'removed', name: sample.name });
    } catch (e) {
      setStatus({ kind: 'error', text: errorDetail(e, 'Could not remove the sample') });
    }
  };

  // A typed start past the end (or end before the start) moves the whole
  // selection there, keeping its length, instead of swapping the edges.
  const setEdge = (edge, t) => {
    if (!selection) return;
    if (edge === 'start' && t >= selection.end) onSelection({ ...selection, start: t, end: t + len });
    else if (edge === 'end' && t <= selection.start) onSelection({ ...selection, start: Math.max(0, t - len), end: t });
    else onSelection({ ...selection, [edge]: t });
  };
  const atPlayhead = (edge) => {
    const t = getPlayhead();
    const dflt = bpm ? (4 * 60) / bpm : 2;
    if (!selection) {
      onSelection(edge === 'start' ? { start: t, end: t + dflt, track: source === 'mix' ? tracks[0] : source } : { start: Math.max(0, t - dflt), end: t, track: source === 'mix' ? tracks[0] : source });
    } else if (edge === 'start') {
      onSelection({ ...selection, start: t, end: t < selection.end ? selection.end : t + dflt });
    } else {
      onSelection({ ...selection, end: t, start: t > selection.start ? selection.start : Math.max(0, t - dflt) });
    }
    onActiveEdge(edge);
  };

  const beat = bpm ? 60 / bpm : null;
  const stepSec = step === 'beat' ? beat || 0.1 : Number(step);
  const readout = selection ? (
    <span className="tabular-nums" aria-live="polite">
      {len.toFixed(3)} s{bpm ? <span className="text-muted"> · {fmtBeats(len, bpm)}</span> : null}
    </span>
  ) : null;

  const savedLabel = (s) => s.name || label;
  const statusLine = (() => {
    if (status?.kind === 'saved') {
      const s = status.sample;
      return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-4" role="status">
          <span className="truncate">Saved “{savedLabel(s)}”</span>
          <TextButton as="a" href={href(`/library?q=${encodeURIComponent(savedLabel(s))}`)} className="rs-hit">
            Open in Library
          </TextButton>
          <TextButton muted onClick={() => undo(s)} className="rs-hit">
            Undo
          </TextButton>
        </span>
      );
    }
    if (status?.kind === 'removed') return <span role="status">Removed “{status.name}”.</span>;
    if (status?.kind === 'error')
      return (
        <span role="alert">
          <span className="text-muted">Error — </span>
          {status.text}
        </span>
      );
    if (tooShort) return <span role="status">Minimum 50 ms</span>;
    if (!selection)
      return (
        <span className="text-muted">
          {sheet || coarse ? 'Tap a waveform to move the playhead, then Set start / Set end; drag the handles to adjust.' : 'Drag across a waveform to select — or set start/end at the playhead.'}
        </span>
      );
    if (!sheet) return <span className="hidden text-muted lg:inline">←/→ nudge 1 ms · Shift 10 ms · Alt 1 beat · [ ] pick edge · Z zoom</span>;
    return null;
  })();

  const isDup = (asMix) => !!selection && keyFor(asMix) === savedKey;
  const saveBtn = (
    <TextButton
      onClick={() => save(source === 'mix')}
      disabled={!selection || tooShort || saving || isDup(source === 'mix')}
      className={`rs-hit text-p ${sheet ? 'h-11 justify-center' : ''}`}
      title={tooShort ? 'Minimum 50 ms' : isDup(source === 'mix') ? 'Already saved — change something to save again' : 'Save to the library (Enter in the name field)'}
    >
      {saving ? 'Saving…' : isDup(source === 'mix') ? 'Saved' : source === 'mix' ? 'Save mix' : 'Save sample'}
    </TextButton>
  );
  const saveMixBtn =
    source !== 'mix' ? (
      <TextButton
        muted
        onClick={() => save(true)}
        disabled={!selection || tooShort || saving || isDup(true)}
        className={`rs-hit ${sheet ? 'h-11 justify-center' : ''}`}
        title="Save what you hear: every audible stem with its current level, mute and solo"
      >
        Save mix
      </TextButton>
    ) : null;

  const sourceSelect = (
    <label className="flex items-center gap-2">
      <span className="text-muted">From</span>
      <select value={source} onChange={(e) => onSource(e.target.value)} className="ainput rs-input w-auto pb-0 capitalize">
        {tracks.map((t) => (
          <option key={t} value={t}>
            {stemLabel(t)} ({variantOf(t)})
          </option>
        ))}
        <option value="mix">Mix of audible stems</option>
      </select>
    </label>
  );

  const fields = (
    <>
      <TimeField
        label="Start"
        value={start}
        disabled={!selection}
        active={activeEdge === 'start'}
        onFocus={() => onActiveEdge('start')}
        onCommit={(t) => setEdge('start', t)}
        step={stepSec}
        steppers={sheet || coarse}
      />
      <TimeField
        label="End"
        value={end}
        disabled={!selection}
        active={activeEdge === 'end'}
        onFocus={() => onActiveEdge('end')}
        onCommit={(t) => setEdge('end', t)}
        step={stepSec}
        steppers={sheet || coarse}
      />
    </>
  );

  const nameInput = (
    <input
      type="text"
      value={name}
      onChange={(e) => {
        setName(e.target.value);
        setNameTouched(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isComposing(e)) {
          e.preventDefault();
          if (!e.repeat) save(source === 'mix');
        }
      }}
      placeholder="Sample name"
      aria-label="Sample name"
      className={`ainput rs-input pb-0 ${sheet ? 'w-full' : 'w-52'}`}
    />
  );
  const tagsInput = (
    <input
      type="text"
      value={tags}
      onChange={(e) => {
        setTags(e.target.value);
        setTagsTouched(true);
      }}
      placeholder="tags, comma separated"
      aria-label="Tags (comma separated)"
      className={`ainput rs-input pb-0 ${sheet ? 'w-full' : 'w-40'}`}
    />
  );
  const msInput = (lbl, value, set) => (
    <label className="flex items-center gap-1.5">
      <span className="text-muted">{lbl}</span>
      <input
        type="number"
        inputMode="numeric"
        min="0"
        max="10000"
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-label={`${lbl} (ms)`}
        className="ainput rs-input w-12 pb-0 text-right tabular-nums"
      />
      <span className="text-muted">ms</span>
    </label>
  );
  const processing = (
    <>
      {msInput('Fade in', fadeIn, setFadeIn)}
      {msInput('Fade out', fadeOut, setFadeOut)}
      <Toggle on={normalize} onClick={() => setNormalize((v) => !v)} title="Peak to −1 dBFS">
        Normalize
      </Toggle>
      <Toggle on={reverse} onClick={() => setReverse((v) => !v)}>
        Reverse
      </Toggle>
      <Toggle on={mono} onClick={() => setMono((v) => !v)}>
        Mono
      </Toggle>
      <label className="flex items-center gap-1.5">
        <span className="text-muted">Format</span>
        <select value={bitDepth} onChange={(e) => setBitDepth(e.target.value)} aria-label="Bit depth" className="ainput rs-input w-auto pb-0">
          <option value="">Source bits</option>
          <option value="16">16-bit</option>
          <option value="24">24-bit</option>
          <option value="32">32-bit float</option>
        </select>
        <select value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Sample rate" className="ainput rs-input w-auto pb-0">
          <option value="">Source rate</option>
          <option value="44100">44.1 kHz</option>
          <option value="48000">48 kHz</option>
        </select>
      </label>
    </>
  );
  const previewBtn = (
    <TextButton
      current={previewing}
      aria-pressed={previewing}
      onClick={onPreview}
      disabled={!selection || tooShort}
      className={`rs-hit ${sheet ? 'h-11 justify-center' : ''}`}
      title={source === 'mix' ? 'Play the selection through the mix' : `Play the selection on ${label} alone`}
    >
      {previewing ? 'Stop' : 'Play selection'}
    </TextButton>
  );
  const loopBtn = (
    <Toggle on={loopOn} onClick={onLoop} title="Repeat the selection (L)">
      Loop
    </Toggle>
  );

  if (sheet) {
    return (
      <Sheet title={`Extract · ${label}`} onClose={onClose} full pinned={viewer} headerExtra={viewerTools}>
        <div className="flex flex-col gap-2 pb-6 pt-1 text-caption">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onTogglePlay}
              className="link h-11 w-11 items-center justify-center"
              aria-label={playing ? 'Pause' : 'Play from the playhead'}
            >
              {playing ? <FiPause className="icon text-h3" aria-hidden="true" /> : <FiPlay className="icon text-h3" aria-hidden="true" />}
            </button>
            {previewBtn}
            {loopBtn}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextButton onClick={() => atPlayhead('start')} className="h-11 justify-center" title="Selection starts at the playhead">
              Set start
            </TextButton>
            <TextButton onClick={() => atPlayhead('end')} className="h-11 justify-center" title="Selection ends at the playhead">
              Set end
            </TextButton>
          </div>
          <div className="flex flex-col gap-1">
            {fields}
            <div className="flex items-center gap-3">
              <span className="text-muted">Step</span>
              <WordToggle
                name="rs-step"
                centerOnMobile={false}
                className="gap-x-4"
                value={step}
                onChange={setStep}
                options={[
                  { value: '0.001', label: '1 ms' },
                  { value: '0.01', label: '10 ms' },
                  { value: '0.1', label: '100 ms' },
                  ...(bpm ? [{ value: 'beat', label: 'Beat' }] : []),
                ]}
              />
            </div>
            <div className="flex h-6 items-center gap-2">
              <span className="text-muted">Length</span>
              {readout || <span className="text-muted">—</span>}
            </div>
          </div>
          {sourceSelect}
          {nameInput}
          {tagsInput}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">{processing}</div>
          <div className="flex items-center gap-6">
            {saveBtn}
            {saveMixBtn}
          </div>
          <div className="min-h-5">{statusLine}</div>
        </div>
      </Sheet>
    );
  }

  return (
    <div
      ref={rootRef}
      className="rs-dock rs-bottom-bar fixed inset-x-0 bottom-0 z-20 overflow-y-auto overscroll-contain border-t border-line bg-paper"
      role="region"
      aria-label="Extract a sample"
    >
      <div className="px-safe mx-auto flex max-w-[1920px] flex-col gap-1.5 py-2 text-caption">
        <div className="rs-touch-lines flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <span className="text-h4 leading-none">Extract</span>
          {sourceSelect}
          {fields}
          {readout}
          <TextButton muted onClick={() => atPlayhead('start')} className="rs-hit" title="Selection starts at the playhead">
            Set start
          </TextButton>
          <TextButton muted onClick={() => atPlayhead('end')} className="rs-hit" title="Selection ends at the playhead">
            Set end
          </TextButton>
          {previewBtn}
          {loopBtn}
          <TextButton muted onClick={onClose} className="rs-hit ml-auto" title="Close (Esc)">
            Close
          </TextButton>
        </div>
        <div className="rs-touch-lines flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {nameInput}
          {tagsInput}
          {processing}
          <span className="ml-auto flex items-baseline gap-5">
            {saveBtn}
            {saveMixBtn}
          </span>
        </div>
        <div className="rs-touch-lines flex min-h-5 min-w-0 items-center">{statusLine}</div>
      </div>
    </div>
  );
}
