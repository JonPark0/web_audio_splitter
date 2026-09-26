import React, { useState } from 'react';
import TextButton from '../../components/TextButton';
import ConfirmAction from './ConfirmAction';
import InlineName from './InlineName';

function formatUpdated(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const SAVE_LABELS = { pending: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: 'Save failed' };

function SaveIndicator({ status, error, onRetry }) {
  return (
    <span role="status" aria-live="polite" className="flex items-baseline gap-3 text-caption text-muted">
      {/* a failed save must be read to act on (Retry), so it's ink */}
      <span title={status === 'error' ? error || undefined : undefined} className={status === 'error' ? 'text-ink' : ''}>
        {SAVE_LABELS[status] || ''}
      </span>
      {status === 'error' && (
        <TextButton onClick={onRetry} className="text-caption">
          Retry
        </TextButton>
      )}
    </span>
  );
}

/**
 * Mixdown to WAV: the whole song, or the loop region when there is one.
 * The scope choice only appears when it's a choice.
 */
function ExportControl({ hasLoop, exporting, disabled, onExport }) {
  const [scope, setScope] = useState('song');
  const effective = hasLoop ? scope : 'song';
  return (
    <span className="flex items-baseline gap-2">
      <TextButton
        muted
        onClick={() => onExport(effective)}
        disabled={disabled || exporting}
        aria-busy={exporting}
        label="Export WAV"
        title="Render a 24-bit / 48 kHz stereo WAV of the mix"
      >
        {exporting ? 'Rendering…' : 'Export WAV'}
      </TextButton>
      {hasLoop && (
        <select
          value={effective}
          onChange={(e) => setScope(e.target.value)}
          disabled={exporting}
          aria-label="Export range"
          className="ainput w-28 !pb-1 text-caption"
        >
          <option value="song">Whole song</option>
          <option value="loop">Loop region</option>
        </select>
      )}
    </span>
  );
}

/** Project picker: current name (click to rename), list, new, export, delete, save state. */
export default function ProjectBar({
  projects,
  project,
  saveStatus,
  saveError,
  busy,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onRetrySave,
  onShowList,
  exporting,
  onExport,
}) {
  const [listOpen, setListOpen] = useState(false);

  const toggleList = () => {
    if (!listOpen) onShowList(); // counts/dates change as you edit - refresh on open
    setListOpen((o) => !o);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-2">
          {project ? (
            <InlineName
              value={project.name}
              label="Project name"
              onCommit={onRename}
              className="max-w-full text-h2 font-light md:max-w-measure"
              inputClassName="text-h2 w-[min(560px,80vw)]"
            />
          ) : (
            <span className="text-h2 font-light text-muted">No project</span>
          )}
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            {/* Open state is the current weight (aria-expanded), no chevron */}
            <TextButton
              muted
              current={listOpen}
              aria-expanded={listOpen}
              onClick={toggleList}
              disabled={!projects.length}
            >
              Projects
            </TextButton>
            <TextButton muted onClick={onCreate} disabled={busy}>
              New project
            </TextButton>
            {project && (
              <ExportControl
                hasLoop={project.loop?.end_beat > project.loop?.start_beat}
                exporting={exporting}
                disabled={busy}
                onExport={onExport}
              />
            )}
            {project && (
              <ConfirmAction label="Delete" question="Delete this project?" disabled={busy} onConfirm={onDelete} />
            )}
          </div>
        </div>
        {project && <SaveIndicator status={saveStatus} error={saveError} onRetry={onRetrySave} />}
      </div>

      {listOpen && projects.length > 0 && (
        // Admin-type rows: a hairline between rows only, never capping the list.
        <ul className="m-0 list-none divide-y divide-line p-0">
          {projects.map((p) => {
            const current = p.id === project?.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setListOpen(false);
                    if (!current) onOpen(p.id);
                  }}
                  aria-current={current ? 'true' : undefined}
                  className="flex w-full flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-0 bg-transparent px-0 py-2 text-left text-ink transition-opacity duration-140 hover:opacity-55"
                >
                  <span className={`min-w-0 truncate ${current ? 'weight-up' : ''}`}>
                    {p.name}
                  </span>
                  <span className="text-caption tabular-nums text-muted">
                    {p.track_count ?? 0} {p.track_count === 1 ? 'track' : 'tracks'} · {p.clip_count ?? 0}{' '}
                    {p.clip_count === 1 ? 'clip' : 'clips'} · {p.bpm} BPM
                    {formatUpdated(p.updated_at) && ` · ${formatUpdated(p.updated_at)}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
