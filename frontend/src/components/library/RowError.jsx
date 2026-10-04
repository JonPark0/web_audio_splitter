import React from 'react';
import { href } from '../../router';
import TextButton from '../TextButton';
import { COARSE } from './ui';

/**
 * A sample's own error, shown on its row (B2) instead of one banner at the
 * top of a long list. A delete refused because projects use the sample
 * names them, each with a link to open it.
 */
export default function RowError({ error, onDismiss, className = '' }) {
  if (!error) return null;
  return (
    <div role="alert" className={`flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0 text-caption ${className}`}>
      {error.projects?.length ? (
        <>
          <span>Used in</span>
          {error.projects.map((p, i) => (
            <span key={p.id} className="inline-flex items-baseline gap-x-2">
              <span className="max-w-[16rem] truncate">{p.name}</span>
              <span className="text-muted">·</span>
              <TextButton as="a" href={href(`/arrange/${p.id}`)} className={COARSE}>
                Open
              </TextButton>
              {i < error.projects.length - 1 && <span className="text-muted">,</span>}
            </span>
          ))}
          <span className="text-muted">— remove its clips there first</span>
        </>
      ) : (
        <span className="min-w-0">
          <span className="text-muted">Error — </span>
          {error.message}
        </span>
      )}
      {onDismiss && (
        <TextButton muted onClick={onDismiss} className={COARSE}>
          Dismiss
        </TextButton>
      )}
    </div>
  );
}
