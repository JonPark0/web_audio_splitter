import React, { useState } from 'react';
import UploadScreen from '../UploadScreen';
import JobsPane from './JobsPane';

/**
 * /split: "New split" and the live Jobs list.
 * - desktop (≥1024): two panes; the form is a sticky 480 px column (520 at
 *   ≥1800) with a hairline between, the jobs list takes the rest.
 * - tablet: the form as a compact two-column grid, then the jobs. By width
 *   (sm:), not device.js, so a landscape phone gets it too, on purpose: on a
 *   ~350 px tall screen the two columns keep the CTA on the first screen,
 *   where the phone's fixed bar would take about a fifth of it for good.
 * - phone: the compact form, its CTA in a fixed bottom bar, then the jobs
 *   (the page pads its bottom by the bar's measured height so the bar never
 *   hides the last row).
 */
export default function SplitHome() {
  const [barHeight, setBarHeight] = useState(0);
  return (
    <div
      style={barHeight ? { '--split-bar': `${barHeight}px` } : undefined}
      className="lg:grid lg:grid-cols-[480px_minmax(0,1fr)] lg:gap-8 min-[1800px]:grid-cols-[520px_minmax(0,1fr)] max-sm:pb-[var(--split-bar,calc(3.5rem+env(safe-area-inset-bottom)))]"
    >
      <h1 className="sr-only">Split</h1>
      <div className="lg:border-r lg:border-line">
        {/* dvh, not vh: Android Chrome measures vh with its URL bar hidden,
            so a vh-capped column ran under the visible bottom edge. The 8 px
            inner gutter keeps focus rings inside its scroll box. */}
        <div className="pb-3 pt-2 sm:pb-4 sm:pt-3 lg:sticky lg:top-12 lg:-ml-2 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-6 lg:pl-2 lg:pr-8 lg:pt-3">
          <UploadScreen onBarHeight={setBarHeight} />
        </div>
      </div>
      <JobsPane className="pb-6" />
    </div>
  );
}
