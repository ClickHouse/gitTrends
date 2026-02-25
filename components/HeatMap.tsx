'use client'

import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 24 }, (_, i) =>
  i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i - 12}pm`
)

interface HeatMapRow {
  day_of_week: number
  hour: number
  cnt: string
}

interface HeatMapProps {
  data: HeatMapRow[]
}

export default function HeatMap({ data }: HeatMapProps) {
  const option = useMemo(() => {
    // Build a 7×24 grid (day_of_week 1=Mon..7=Sun, hour 0..23)
    const matrix: [number, number, number][] = []
    const lookup = new Map<string, number>()

    for (const row of data) {
      const day = row.day_of_week - 1 // 0-indexed
      lookup.set(`${day}-${row.hour}`, Number(row.cnt))
    }

    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        matrix.push([h, d, lookup.get(`${d}-${h}`) ?? 0])
      }
    }

    const max = Math.max(...matrix.map((m) => m[2]))

    return {
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        backgroundColor: '#1a1a1a',
        borderColor: '#2a2a2a',
        textStyle: { color: '#e5e5e5', fontFamily: 'Inter', fontSize: 12 },
        formatter: (p: { value: number[] }) =>
          `${DAYS[p.value[1]]} ${HOURS[p.value[0]]}<br/><b>${p.value[2].toLocaleString()}</b> comments`,
      },
      grid: {
        top: 8,
        bottom: 30,
        left: 48,
        right: 8,
      },
      xAxis: {
        type: 'category',
        data: HOURS,
        splitArea: { show: true },
        axisLabel: {
          color: '#666',
          fontSize: 10,
          interval: 2,
          fontFamily: 'Inter',
        },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
      },
      yAxis: {
        type: 'category',
        data: DAYS,
        splitArea: { show: true },
        axisLabel: {
          color: '#999',
          fontSize: 11,
          fontFamily: 'Inter',
        },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
      },
      visualMap: {
        min: 0,
        max,
        calculable: false,
        show: false,
        inRange: {
          color: ['#1a1a1a', '#332800', '#7a5c00', '#c89500', '#FAFF69'],
        },
      },
      series: [
        {
          type: 'heatmap',
          data: matrix,
          label: { show: false },
          emphasis: {
            itemStyle: {
              borderColor: '#FAFF69',
              borderWidth: 2,
            },
          },
        },
      ],
    }
  }, [data])

  return (
    <ReactECharts
      option={option}
      style={{ width: '100%', height: '100%' }}
      theme="dark"
    />
  )
}
