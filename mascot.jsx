// mascot.jsx — a friendly Pixl character

const Mascot = ({ mood = "idle" }) => {
  return (
    <svg className="mascot" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="msk-body" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ffb594" />
          <stop offset="60%" stopColor="#ff8c66" />
          <stop offset="100%" stopColor="#f06d44" />
        </radialGradient>
        <radialGradient id="msk-shine" cx="35%" cy="30%" r="22%">
          <stop offset="0%" stopColor="#fff8ec" stopOpacity=".9" />
          <stop offset="100%" stopColor="#fff8ec" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* body — rounded square (pixel) */}
      <rect x="14" y="18" width="72" height="68" rx="22" fill="url(#msk-body)" />
      {/* shine */}
      <rect x="14" y="18" width="72" height="68" rx="22" fill="url(#msk-shine)" />
      {/* cheeks */}
      <circle cx="30" cy="58" r="6" fill="#ff5d83" opacity=".5" />
      <circle cx="70" cy="58" r="6" fill="#ff5d83" opacity=".5" />
      {/* eyes */}
      <g fill="#231a3a">
        <circle cx="38" cy="48" r="4.5" />
        <circle cx="62" cy="48" r="4.5" />
      </g>
      <g fill="#fff">
        <circle cx="39.5" cy="46.5" r="1.4" />
        <circle cx="63.5" cy="46.5" r="1.4" />
      </g>
      {/* smile */}
      <path d="M40 64 Q50 72 60 64" stroke="#231a3a" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      {/* antenna (pixel pop) */}
      <rect x="48" y="8" width="4" height="10" rx="2" fill="#f5a623" />
      <circle cx="50" cy="6" r="4" fill="#ffd76b" />
    </svg>
  );
};

window.Mascot = Mascot;
