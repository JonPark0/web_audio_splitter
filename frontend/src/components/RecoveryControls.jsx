import React, { useId } from 'react';
import { RECOVERY_MODELS } from '../api';
import Field from './Field';
import WordToggle from './WordToggle';

const ON_OFF = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
];

/**
 * Opt-in "restore missing frequencies" toggle + restoration model, as dense
 * label-left rows. Shared by the new-split form and RetryPanel. Hints are
 * one caption line from 640px up (on phones the words say enough).
 */
export default function RecoveryControls({ recover, setRecover, recoveryModel, setRecoveryModel, disabled = false }) {
  const uid = useId();
  const activeModel = RECOVERY_MODELS.find((m) => m.value === recoveryModel);

  return (
    <div className="flex flex-col gap-1">
      <Field inline label="Restore" labelId={`${uid}-restore`}>
        <WordToggle
          name={`${uid}-recover`}
          aria-labelledby={`${uid}-restore`}
          options={ON_OFF}
          value={recover ? 'on' : 'off'}
          onChange={(v) => setRecover(v === 'on')}
          disabled={disabled}
        />
      </Field>
      {recover && (
        <Field inline label="Restorer" labelId={`${uid}-restorer`}>
          <WordToggle
            name={`${uid}-recovery-model`}
            aria-labelledby={`${uid}-restorer`}
            options={RECOVERY_MODELS}
            value={recoveryModel}
            onChange={setRecoveryModel}
            disabled={disabled}
          />
        </Field>
      )}
      <p className="m-0 pl-[calc(5rem+0.75rem)] text-caption text-muted max-sm:hidden">
        {recover
          ? activeModel?.hint
          : 'An extra AI pass per stem that recovers detail lost to lossy sources. Adds time.'}
      </p>
    </div>
  );
}
