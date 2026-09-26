import React from 'react';

/** Muted label above an underlined control (Palnarium .afield). */
export default function Field({ label, htmlFor, hint, children, className = '' }) {
  const Tag = htmlFor ? 'label' : 'div';
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <Tag {...(htmlFor ? { htmlFor } : {})} className="text-muted">
        {label}
      </Tag>
      {children}
      {hint && <p className="m-0 text-caption text-muted">{hint}</p>}
    </div>
  );
}
