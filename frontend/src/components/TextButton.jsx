import React from 'react';

/**
 * Palnarium-style text control: no box, weight 300 -> 400 on hover. The
 * `data-label` ghost keeps the width stable while the weight changes, so
 * pass plain-text `label` when children contain icons. A `ref` reaches the
 * element (for moving focus).
 */
const TextButton = React.forwardRef(function TextButton(
  { as: Tag = 'button', label, children, current = false, muted = false, className = '', ...rest },
  ref
) {
  const text = label ?? (typeof children === 'string' ? children : undefined);
  const classes = ['link', muted && 'link--muted', current && 'is-current', className]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      ref={ref}
      {...(Tag === 'button' ? { type: 'button' } : {})}
      {...rest}
      data-label={text}
      className={classes}
    >
      {children}
    </Tag>
  );
});

export default TextButton;
