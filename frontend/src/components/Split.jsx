import React from 'react';

/**
 * 50 / 50 split (Palnarium .split): a large centred title on the left,
 * pinned to the viewport's vertical centre on desktop, and the screen's
 * content on the right. Stacks, title first, at <= 768px.
 * Spacing: s-8 block padding, s-6 column gap (s-4 + s-2 under the title
 * when stacked).
 */
export default function Split({ title, children }) {
  return (
    <div className="grid grid-cols-1 gap-8 py-16 text-center md:min-h-[62vh] md:grid-cols-2 md:items-center md:gap-12 md:text-left">
      <div className="mb-4 text-center md:sticky md:top-[50vh] md:mb-0 md:-translate-y-1/2 md:self-start">
        <h1 className="m-0 text-title-sm font-light md:text-title">{title}</h1>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
