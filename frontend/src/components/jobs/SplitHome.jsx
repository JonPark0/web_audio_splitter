import React from 'react';
import UploadScreen from '../UploadScreen';
import JobsPane from './JobsPane';

/**
 * /split: "New split" and the live Jobs list.
 * - desktop (≥1024): two panes; the form is a sticky 480 px column (520 at
 *   ≥1800) with a hairline between, the jobs list takes the rest.
 * - tablet: the form as a compact two-column grid, then the jobs.
 * - phone: the compact form, its CTA in a fixed bottom bar, then the jobs
 *   (the page pads its bottom so the bar never hides the last row).
 */
export default function SplitHome() {
  return (
    <div className="lg:grid lg:grid-cols-[480px_minmax(0,1fr)] lg:gap-8 min-[1800px]:grid-cols-[520px_minmax(0,1fr)] max-sm:pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <h1 className="sr-only">Split</h1>
      <div className="lg:border-r lg:border-line">
        <div className="pb-3 pt-2 sm:pb-4 sm:pt-3 lg:sticky lg:top-12 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pb-6 lg:pr-8 lg:pt-3">
          <UploadScreen />
        </div>
      </div>
      <JobsPane className="pb-6" />
    </div>
  );
}
