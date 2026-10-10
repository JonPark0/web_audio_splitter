import React from 'react';
import { getTasks } from '../../api';
import { href } from '../../router';
import { jobsPaneMounted, onJobsChanged, publishFromTasks, useInFlight } from '../jobs/jobsStore';
import usePoll from './usePoll';
import { revealHeading, revealOnArrival } from './useRouteFocus';

/**
 * "2 running" in the header, linking to the jobs list. It polls /tasks for
 * `in_flight` itself (every 3 s while something runs, else 20 s) only when
 * no jobs list is on screen — that one publishes the same number.
 *
 * Where a jobs list is on screen (the Split home, a job) it scrolls to that
 * list instead of navigating (on phones it is below the form or the job);
 * elsewhere it opens /split at the list rather than at the top.
 */
export default function JobsBadge({ className = '' }) {
  const n = useInFlight();
  const refresh = usePoll(
    async (ctx) => {
      if (jobsPaneMounted()) return undefined;
      try {
        const res = await getTasks({ limit: 1 });
        if (ctx.stale()) return undefined;
        return publishFromTasks(res.data);
      } catch (e) {
        return undefined;
      }
    },
    (count) => ((count ?? n) > 0 ? 3000 : 20000),
    []
  );
  React.useEffect(() => onJobsChanged(refresh), [refresh]);

  if (!n) return null;
  const label = `${n} running`;
  return (
    <a
      href={href('/split')}
      data-label={label}
      aria-label={`${n} ${n === 1 ? 'job' : 'jobs'} running — show jobs`}
      className={`link relative shrink-0 whitespace-nowrap text-caption ${className}`}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab / window
        if (revealHeading('jobs-heading')) e.preventDefault();
        else revealOnArrival('jobs-heading');
      }}
    >
      {label}
      {/* the same sliding hairline as running rows */}
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px overflow-hidden bg-line">
        <span className="absolute inset-y-0 left-0 w-1/3 animate-slide bg-ink" />
      </span>
    </a>
  );
}
