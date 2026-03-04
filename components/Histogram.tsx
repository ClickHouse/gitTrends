'use client'

import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'

interface HistRow {
  bucket: string
  count: string
}

export interface HistSeries {
  term: string
  data: HistRow[]
}

interface HistogramProps {
  series: HistSeries[]
  granularity: string
}

export const SERIES_COLORS = ['#FAFF69', '#60a5fa', '#f472b6', '#34d399', '#fb923c']

function formatBucket(bucket: string, granularity: string): string {
  const d = new Date(bucket.replace(' ', 'T') + 'Z')
  if (granularity === 'toStartOfMonth') {
    return d.toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function Histogram({ series, granularity }: HistogramProps) {
  const option = useMemo(() => {
    const isCompare = series.length > 1

    const allBuckets = [...new Set(series.flatMap((s) => s.data.map((d) => d.bucket)))].sort()
    const labels = allBuckets.map((b) => formatBucket(b, granularity))

    const chartSeries = series.map((s, i) => {
      const map = new Map(s.data.map((d) => [d.bucket, Number(d.count)]))
      const values = allBuckets.map((b) => map.get(b) ?? 0)
      const color = SERIES_COLORS[i] ?? SERIES_COLORS[SERIES_COLORS.length - 1]

      if (!isCompare) {
        return {
          name: s.term,
          type: 'bar',
          data: values,
          itemStyle: { color, borderRadius: [2, 2, 0, 0] },
          emphasis: { itemStyle: { color: '#ffffff' } },
          barMaxWidth: 24,
        }
      }
      return {
        name: s.term,
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'none',
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        emphasis: { focus: 'series' },
        areaStyle: i === 0 ? { color: `${color}18` } : undefined,
      }
    })

    return {
      backgroundColor: 'transparent',
      grid: { left: 44, right: 12, top: isCompare ? 26 : 6, bottom: 32 },
      legend: isCompare ? {
        show: true,
        top: 2,
        textStyle: { color: '#aaa', fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif' },
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
      } : { show: false },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1a1a1a',
        borderColor: '#2a2a2a',
        textStyle: { color: '#e5e5e5', fontFamily: 'Inter', fontSize: 12 },
        formatter: (params: { seriesName: string; axisValue: string; value: number; color: string }[]) => {
          if (!isCompare) {
            const p = params[0]
            return `${p.axisValue}<br/>${Number(p.value).toLocaleString()} events`
          }
          const lines = params
            .filter((p) => p.value > 0)
            .map((p) => `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${Number(p.value).toLocaleString()}</b>`)
          return [params[0]?.axisValue, ...lines].join('<br/>')
        },
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#555', fontSize: 10, fontFamily: 'Inter, system-ui, sans-serif' },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1e1e1e' } },
        axisLabel: {
          color: '#555',
          fontSize: 10,
          fontFamily: 'Inter, system-ui, sans-serif',
          formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
        },
      },
      series: chartSeries,
    }
  }, [series, granularity])

  return (
    <ReactECharts
      option={option}
      notMerge
      style={{ width: '100%', height: '100%' }}
      theme="dark"
    />
  )
}
