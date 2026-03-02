'use client'

import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'

interface HistRow {
  bucket: string
  count: string
}

interface HistogramProps {
  data: HistRow[]
  granularity: string
}

function formatBucket(bucket: string, granularity: string): string {
  const d = new Date(bucket.replace(' ', 'T') + 'Z')
  if (granularity === 'toStartOfMonth') {
    return d.toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function Histogram({ data, granularity }: HistogramProps) {
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    grid: { left: 44, right: 12, top: 6, bottom: 32 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a1a1a',
      borderColor: '#2a2a2a',
      textStyle: { color: '#e5e5e5', fontFamily: 'Inter', fontSize: 12 },
      formatter: (params: { axisValue: string; value: number }[]) => {
        const p = params[0]
        return `${p.axisValue}<br/>${Number(p.value).toLocaleString()} events`
      },
    },
    xAxis: {
      type: 'category',
      data: data.map((d) => formatBucket(d.bucket, granularity)),
      axisLabel: { color: '#555', fontSize: 10, fontFamily: 'monospace' },
      axisLine:  { lineStyle: { color: '#2a2a2a' } },
      axisTick:  { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#1e1e1e' } },
      axisLabel: {
        color: '#555',
        fontSize: 10,
        fontFamily: 'monospace',
        formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
      },
    },
    series: [{
      type: 'bar',
      data: data.map((d) => Number(d.count)),
      itemStyle: { color: '#FAFF69', borderRadius: [2, 2, 0, 0] },
      emphasis:  { itemStyle: { color: '#ffffff' } },
      barMaxWidth: 24,
    }],
  }), [data, granularity])

  return (
    <ReactECharts
      option={option}
      style={{ width: '100%', height: '100%' }}
      theme="dark"
    />
  )
}
