import React from 'react';
import { RECOVERY_MODELS } from '../api';
import Field from './Field';
import WordToggle from './WordToggle';

const ON_OFF = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
];

/**
 * Opt-in "restore missing frequencies" toggle + model picker. Shared by both
 * the file-upload and YouTube flows in UploadScreen.
 */
export default function RecoveryControls({ recover, setRecover, recoveryModel, setRecoveryModel }) {
  const activeModel = RECOVERY_MODELS.find((m) => m.value === recoveryModel);

  return (
    <div className="flex flex-col gap-6">
      <Field
        label="Restore missing frequencies"
        hint="Runs an extra AI pass per stem to recover mid/high-frequency detail lost to lossy sources and separation. Adds processing time — slower on CPU."
      >
        <WordToggle
          name="recover"
          options={ON_OFF}
          value={recover ? 'on' : 'off'}
          onChange={(v) => setRecover(v === 'on')}
        />
      </Field>

      {recover && (
        <Field label="Restoration model" hint={activeModel?.hint}>
          <WordToggle
            name="recovery-model"
            options={RECOVERY_MODELS}
            value={recoveryModel}
            onChange={setRecoveryModel}
          />
        </Field>
      )}
    </div>
  );
}
