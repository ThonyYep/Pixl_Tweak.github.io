// icons.jsx — thin wrapper over the sprite in icons.svg.
//
// The icons used to sit inline here: 42 KB of path data compiled into the
// bundle and re-downloaded whenever any app code changed. They now live in
// icons.svg, which the browser fetches once and caches independently.
//
// 23 symbols. Seven more were carried for a while — download, flip,
// folder-export, link, max, min, play — with nothing referencing them; the
// name reaches the sprite by plain interpolation below, so an unquoted name
// cannot be reached by any route.

(function () {
  if (document.getElementById("icon-anim-styles")) return;
  const s = document.createElement("style");
  s.id = "icon-anim-styles";
  s.textContent = `
    @keyframes drop-bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(3px); }
    }
    .icon-drop-bounce { animation: drop-bounce 1.4s ease-in-out infinite; }
  `;
  document.head.appendChild(s);
})();

// Icons that carry an animation class of their own.
const ICON_CLASS = { upload: "icon-drop-bounce" };

const Icon = ({ name, size = 18, stroke = 1.7, className, style, ...rest }) => {
  const cls = [ICON_CLASS[name], className].filter(Boolean).join(" ");
  return (
    // Each symbol declares its own fill and stroke, so the only paint detail
    // left here is stroke-width, which callers vary. It is an inherited
    // property, so it reaches the referenced content through <use>.
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cls || undefined}
      style={{ width: size, height: size, ...style }}
      {...rest}>
      <use href={`icons.svg#ico-${name}`} />
    </svg>
  );
};

window.Icon = Icon;
