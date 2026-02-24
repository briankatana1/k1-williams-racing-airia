"use client"

export function WilliamsLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Williams Racing"
    >
      <text
        x="0"
        y="20"
        fontFamily="Geist, sans-serif"
        fontWeight="800"
        fontSize="22"
        letterSpacing="4"
        fill="currentColor"
      >
        WILLIAMS
      </text>
      <text
        x="164"
        y="20"
        fontFamily="Geist, sans-serif"
        fontWeight="300"
        fontSize="10"
        letterSpacing="2"
        fill="currentColor"
        opacity="0.6"
      >
        AI
      </text>
    </svg>
  )
}
