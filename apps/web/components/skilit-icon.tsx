import iconset from "../registry/skilit-ui-icons.json";

export type SkilitIconName = keyof typeof iconset.icons;

export function SkilitIcon({
  name,
  size = 22,
  className,
}: {
  name: SkilitIconName;
  size?: number;
  className?: string;
}) {
  // First-party SVG paths from the existing Iconify-compatible
  // Skilit icon source. Never inject arbitrary HTML into the DOM.
  const glyph = iconset.icons[name];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {glyph.paths.map((path, index) => (
        <path d={path} key={index} />
      ))}
    </svg>
  );
}
