// Atrium monogram — an "A" / atrium: two converging walls (the two legs of the atomic
// swap) under an open roof, a brass skylight bar admitting light, and a brass floor line.
// Steel = #5e8fb5, brass = #c68a3e. Designed on a 32 grid so it holds at favicon scale.
export function AtriumMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Atrium"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* converging walls — open at the apex (the skylight) */}
      <path d="M6.5 25.5 L15 6.5" stroke="#5e8fb5" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M25.5 25.5 L17 6.5" stroke="#5e8fb5" strokeWidth="2.4" strokeLinecap="round" />
      {/* skylight bar — light entering the open roof */}
      <path d="M13.6 4 L18.4 4" stroke="#c68a3e" strokeWidth="2.4" strokeLinecap="round" />
      {/* atrium floor / crossbar */}
      <path d="M10.5 18.5 L21.5 18.5" stroke="#c68a3e" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}
