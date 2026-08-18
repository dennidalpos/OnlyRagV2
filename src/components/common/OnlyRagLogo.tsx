import React from 'react'

interface OnlyRagLogoProps {
  className?: string
  size?: number | string
  glow?: boolean
}

export const OnlyRagLogo: React.FC<OnlyRagLogoProps> = ({
  className = 'w-full h-full',
  size,
  glow = true,
}) => {
  const style = size ? { width: size, height: size } : undefined

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      className={className}
      style={style}
      aria-label="OnlyRag V2 Logo"
    >
      <defs>
        {/* Background Gradient */}
        <radialGradient id="onlyragBgGrad" cx="50%" cy="50%" r="50%" fx="30%" fy="30%">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="60%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#020617" />
        </radialGradient>

        {/* Outer Border Glow Gradient */}
        <linearGradient id="onlyragBadgeBorder" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#0284c7" stopOpacity="0.5" />
        </linearGradient>

        {/* Neon Cyan Stroke Gradient */}
        <linearGradient id="onlyragNeonCyan" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="50%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>

        {/* Glow Filter */}
        <filter id="onlyragNeonGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" result="blur1" />
          <feGaussianBlur stdDeviation="14" result="blur2" />
          <feMerge>
            <feMergeNode in="blur2" />
            <feMergeNode in="blur1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <radialGradient id="onlyragNucleusGrad" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#06b6d4" />
        </radialGradient>
      </defs>

      {/* Circular Badge Background */}
      <circle cx="256" cy="256" r="236" fill="url(#onlyragBgGrad)" stroke="url(#onlyragBadgeBorder)" strokeWidth="8" />

      {/* Ambient Glow Behind Atomic Structure */}
      {glow && (
        <circle cx="256" cy="256" r="140" fill="#0891b2" opacity="0.18" filter="url(#onlyragNeonGlow)" />
      )}

      {/* Atomic Orbital Rings Group */}
      <g filter={glow ? 'url(#onlyragNeonGlow)' : undefined}>
        {/* Vertical Orbit (0 deg) */}
        <ellipse cx="256" cy="256" rx="66" ry="160" fill="none" stroke="url(#onlyragNeonCyan)" strokeWidth="12" strokeLinecap="round" />

        {/* Tilted Orbit (60 deg) */}
        <ellipse cx="256" cy="256" rx="66" ry="160" fill="none" stroke="url(#onlyragNeonCyan)" strokeWidth="12" strokeLinecap="round" transform="rotate(60 256 256)" />

        {/* Tilted Orbit (120 deg) */}
        <ellipse cx="256" cy="256" rx="66" ry="160" fill="none" stroke="url(#onlyragNeonCyan)" strokeWidth="12" strokeLinecap="round" transform="rotate(120 256 256)" />

        {/* Electron Node Spheres */}
        <circle cx="348" cy="172" r="14" fill="url(#onlyragNucleusGrad)" stroke="#0f172a" strokeWidth="3" />
        <circle cx="145" cy="225" r="14" fill="url(#onlyragNucleusGrad)" stroke="#0f172a" strokeWidth="3" />
        <circle cx="282" cy="392" r="14" fill="url(#onlyragNucleusGrad)" stroke="#0f172a" strokeWidth="3" />

        {/* Central Nucleus */}
        <circle cx="256" cy="256" r="24" fill="url(#onlyragNucleusGrad)" stroke="#0f172a" strokeWidth="4" />
      </g>
    </svg>
  )
}
