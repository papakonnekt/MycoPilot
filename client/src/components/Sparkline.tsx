import { useMemo } from 'react'

export interface SparklineDataPoint {
  date: string
  be: number
}

interface SparklineProps {
  data: SparklineDataPoint[]
  width?: number
  height?: number
  color?: string
  strokeWidth?: number
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = 'var(--bio-green)',
  strokeWidth = 1.5,
}: SparklineProps) {
  const pathData = useMemo(() => {
    if (!data || data.length === 0) return ''
    if (data.length === 1) {
      return `M 0,${height / 2} L ${width},${height / 2}`
    }

    // Find min and max BE to scale
    let minBe = data[0].be
    let maxBe = data[0].be
    for (const d of data) {
      if (d.be < minBe) minBe = d.be
      if (d.be > maxBe) maxBe = d.be
    }

    // Add some padding to min/max so lines don't hit the exact edge
    const range = Math.max(maxBe - minBe, 0.01) // avoid div/0
    const paddedMin = minBe - range * 0.1
    const paddedMax = maxBe + range * 0.1
    const paddedRange = paddedMax - paddedMin

    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * width
      // Y is inverted (0 is top)
      const y = height - ((d.be - paddedMin) / paddedRange) * height
      return `${x},${y}`
    })

    return `M ${points.join(' L ')}`
  }, [data, width, height])

  if (!data || data.length === 0) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--surface-muted)"
          strokeWidth={1}
          strokeDasharray="2 2"
          opacity={0.3}
        />
      </svg>
    )
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
