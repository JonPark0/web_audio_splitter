import React from 'react';

/**
 * Muted label with an underlined control (Palnarium .afield). Stacked by
 * default (label above); `inline` puts a narrow caption label on the left of
 * the control in one row — the dense form layout.
 */
export default function Field({ label, htmlFor, hint, children, className = '', inline = false, labelId }) {
  const Tag = htmlFor ? 'label' : 'div';
  const labelProps = { ...(htmlFor ? { htmlFor } : {}), ...(labelId ? { id: labelId } : {}) };
  if (inline) {
    return (
      <div className={`grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-3 ${className}`}>
        <Tag {...labelProps} className="text-caption text-muted">
          {label}
        </Tag>
        <div className="min-w-0">{children}</div>
        {hint && <p className="col-start-2 m-0 text-caption text-muted">{hint}</p>}
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <Tag {...labelProps} className="text-muted">
        {label}
      </Tag>
      {children}
      {hint && <p className="m-0 text-caption text-muted">{hint}</p>}
    </div>
  );
}
