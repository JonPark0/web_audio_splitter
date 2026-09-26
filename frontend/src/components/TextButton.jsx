import React from 'react';

/**
 * Palnarium-style text control: no box, weight 300 -> 400 on hover. The
 * `data-label` ghost keeps the width stable while the weight changes, so
 * pass plain-text `label` when children contain icons.
 */
export default function TextButton({
  as: Tag = 'button',
  label,
  children,
  current = false,
  muted = false,
  className = '',
  ...rest
}) {
  const text = label ?? (typeof children === 'string' ? children : undefined);
  const classes = ['link', muted && 'link--muted', current && 'is-current', className]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      {...(Tag === 'button' ? { type: 'button' } : {})}
      {...rest}
      data-label={text}
      className={classes}
    >
      {children}
    </Tag>
  );
}
