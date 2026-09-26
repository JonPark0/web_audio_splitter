import React from 'react';

/**
 * 50 / 50 split (Palnarium list/admin pages): a large centred title on the
 * left, pinned to the viewport's vertical centre on desktop, and the screen's
 * content on the right. Stacks, title first, at <= 768px.
 */
export default function Split({ title, children }) {
  return (
    <div className="grid grid-cols-1 gap-8 py-8 text-center md:min-h-[62vh] md:grid-cols-2 md:items-center md:gap-12 md:py-16 md:text-left">
      <div className="text-center md:sticky md:top-[50vh] md:-translate-y-1/2 md:self-start">
        <h1 className="m-0 text-title-sm font-light leading-tight md:text-title">{title}</h1>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
