/**
 * Keyboard helpers shared by the screens' shortcut handlers and fields.
 */
import { isApple } from './device';

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/**
 * True for controls that take typed text (text/number/search fields,
 * textareas, contentEditable). Shortcuts step aside only for these: a focused
 * slider, toggle or select must not swallow Space/Delete/arrows (clicking a
 * fader and then pressing Space should still play).
 */
export function isTextEntry(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
  return target.tagName === 'INPUT' && !NON_TEXT_INPUTS.has(target.type);
}

/** A focused <select>: arrows/Space belong to it, letter shortcuts don't. */
export function isSelect(target) {
  return !!target && target.tagName === 'SELECT';
}

/**
 * True while an IME is composing (Korean, Japanese, Chinese, many Android
 * keyboards). The Enter that confirms a composition must not also commit the
 * field: Chrome then re-inserts the last syllable into the cleared input.
 * Works with React synthetic and native events.
 */
export function isComposing(e) {
  const n = e?.nativeEvent || e;
  return !!n && (n.isComposing || n.keyCode === 229);
}

/**
 * The letter or digit a shortcut stands for. `e.key` with a Hangul or
 * Cyrillic layout active is 'ㄴ' / 'ы' / 'Process' rather than 's', so fall
 * back to the physical key (`e.code`) when `e.key` isn't Latin. Latin layouts
 * keep `e.key`, so AZERTY's Ctrl+Z is still the key labelled Z.
 */
export function shortcutKey(e) {
  const key = (e.key || '').toLowerCase();
  if (/^[a-z0-9]$/.test(key)) return key;
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return key;
}

/** 'Ctrl' or '⌘' for shortcut hints. */
export const MOD = isApple ? '⌘' : 'Ctrl';

/**
 * Number typed into a field, accepting a decimal comma (European iOS and
 * Android keypads only offer ','). NaN when it isn't a number; '' is NaN too.
 */
export function parseDecimal(text) {
  const s = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '' || s === '-' || s === '.') return NaN;
  return Number(s);
}
