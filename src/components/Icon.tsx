type IconName = 'pulse' | 'sliders' | 'signal' | 'chip' | 'layers' | 'play' | 'pause' | 'reset' | 'bluetooth' | 'chevron' | 'info'

const paths: Record<IconName, string> = {
  pulse: 'M2 12h5l3-8 4 16 3-10 2 2h3',
  sliders: 'M4 7h6m4 0h6M4 17h10m4 0h2M10 4v6m4 4v6',
  signal: 'M3 17V7m6 13V4m6 13V7m6 8V9',
  chip: 'M8 3v3m8-3v3M8 18v3m8-3v3M3 8h3m-3 8h3m12-8h3m-3 8h3M6 6h12v12H6zM10 10h4v4h-4z',
  layers: 'm3 7 9-4 9 4-9 4-9-4zm0 5 9 4 9-4M3 17l9 4 9-4',
  play: 'm8 5 11 7-11 7V5z',
  pause: 'M8 5v14M16 5v14',
  reset: 'M3 11a9 9 0 1 1 2 7M3 4v7h7',
  bluetooth: 'm7 7 10 10-5 4V3l5 4L7 17',
  chevron: 'm9 5 7 7-7 7',
  info: 'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
