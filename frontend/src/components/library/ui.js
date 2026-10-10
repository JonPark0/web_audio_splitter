// Shared class strings for the library's own controls.

// >= 44x44 hit area on touch screens (the layout contract), invisible with a
// mouse: the box grows, the word/glyph stays centred.
export const COARSE =
  'coarse:min-h-11 coarse:min-w-11 coarse:justify-center';

// Square icon button: 32px with a mouse, 44px on touch.
export const ICON_BTN = `h-8 w-8 shrink-0 justify-center ${COARSE}`;

// Fields on touch screens: 16px text so iOS doesn't zoom in, 44px tall.
export const TOUCH_TEXT = 'coarse:text-p coarse:min-h-11';
