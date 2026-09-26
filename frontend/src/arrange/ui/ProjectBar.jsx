import React, { useState } from 'react';
import { FiChevronDown, FiChevronUp, FiPlus } from 'react-icons/fi';
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
      <span title={status === 'error' ? error || undefined : undefined}>{SAVE_LABELS[status] || ''}</span>
      {status === 'error' && (
        <TextButton onClick={onRetry} className="text-caption">
          Retry
        </TextButton>
      )}
    </span>
  );
}

/** Project picker: current name (click to rename), list, new, delete, save state. */
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
              className="max-w-full text-h2 font-light md:max-w-[520px]"
              inputClassName="text-h2 w-[min(520px,80vw)]"
            />
          ) : (
            <span className="text-h2 font-light text-muted">No project</span>
          )}
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <TextButton
              muted
              current={listOpen}
              aria-expanded={listOpen}
              onClick={toggleList}
              label="Projects"
              disabled={!projects.length}
            >
              <span className="inline-flex items-center gap-1.5">
                <span>Projects</span>
                {listOpen ? (
                  <FiChevronUp className="icon" strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <FiChevronDown className="icon" strokeWidth={1.5} aria-hidden="true" />
                )}
              </span>
            </TextButton>
            <TextButton muted onClick={onCreate} disabled={busy} label="New project">
              <span className="inline-flex items-center gap-1.5">
                <FiPlus className="icon" strokeWidth={1.5} aria-hidden="true" />
                <span>New project</span>
              </span>
            </TextButton>
            {project && (
              <ConfirmAction label="Delete" question="Delete this project?" disabled={busy} onConfirm={onDelete} />
            )}
          </div>
        </div>
        {project && <SaveIndicator status={saveStatus} error={saveError} onRetry={onRetrySave} />}
      </div>

      {listOpen && projects.length > 0 && (
        <ul className="m-0 list-none border-t border-line p-0">
          {projects.map((p) => {
            const current = p.id === project?.id;
            return (
              <li key={p.id} className="border-b border-line">
                <button
                  type="button"
                  onClick={() => {
                    setListOpen(false);
                    if (!current) onOpen(p.id);
                  }}
                  aria-current={current ? 'true' : undefined}
                  className="flex w-full flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-0 bg-transparent px-0 py-2 text-left text-ink hover:bg-hover"
                >
                  <span className={`min-w-0 truncate ${current ? '[font-variation-settings:"wght"_400]' : ''}`}>
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
