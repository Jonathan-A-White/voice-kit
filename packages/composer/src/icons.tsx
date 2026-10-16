// icons.tsx — the composer's few icons, lifted from Postern's src/ui/Icon.tsx: 24x24 stroke glyphs drawn inline,
// so the package ships no icon font or dependency and every icon follows the colour (currentColor) of where it sits.

const PATHS = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6.5 9a6.5 6.5 0 0 0 13 0M12 18.5V21',
  attach: 'm20 11.5-7.8 7.8a5 5 0 0 1-7-7l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3',
  camera: 'M4 8h3l1.5-2.5h7L17 8h3v11H4V8Zm8 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  file: 'M14 3H6v18h12V7l-4-4Zm0 0v4h4',
  send: 'M4 12 20 4l-4.5 16-3.5-6.5L4 12Zm8 1.5L20 4',
  x: 'M6 6l12 12M18 6 6 18',
} as const;

export type IconName = keyof typeof PATHS;

/** A decorative icon: the button or text beside it carries the name. */
export function Icon({ name, size = 20, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      className="bk-composer__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
