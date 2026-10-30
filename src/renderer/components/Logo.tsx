import React from 'react';

// Humatron's mark: the "memory loop" - an open ring with a node in the gap (a thought being kept).
// `active` = the loop orbits and the core lights up while the model is working.
export function Logo({ size = 40, active = false }: { size?: number, active?: boolean }) {
  return (
    <span className={`logo ${active ? 'active' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <rect className="logo-tile" x="0.5" y="0.5" width="39" height="39" rx="11" />
        <g className="logo-spin">
          {/* r=10 ring, 49/63 drawn; rotated so the gap sits top-right where the node is */}
          <circle className="logo-ring" cx="20" cy="20" r="10" strokeDasharray="47 15.8" transform="rotate(-1 20 20)" />
          <circle className="logo-node" cx="27.07" cy="12.93" r="3.3" />
        </g>
        <circle className="logo-core" cx="20" cy="20" r="2.6" />
      </svg>
    </span>
  );
}
