'use client'

import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'

interface ContributorRow {
  actor_login: string
  issues: string
  prs: string
  comments: string
  total: string
}

interface ContributorsChartProps {
  data: ContributorRow[]
}

// Reverse so the highest bar sits at the top of the chart
function rev<T>(arr: T[]): T[] { return [...arr].reverse() }

const FONT = 'Inter, system-ui, sans-serif'

export default function ContributorsChart({ data }: ContributorsChartProps) {
  const option = useMemo(() => {
    const sorted   = rev(data)
    const names    = sorted.map((d) => d.actor_login)
    const issues   = sorted.map((d) => Number(d.issues))
    const prs      = sorted.map((d) => Number(d.prs))
    const comments = sorted.map((d) => Number(d.comments))

    return {
      backgroundColor: 'transparent',
      grid: { left: 130, right: 16, top: 4, bottom: 20 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#1a1a1a',
        borderColor: '#2a2a2a',
        textStyle: { color: '#e5e5e5', fontFamily: FONT, fontSize: 12 },
        formatter: (params: { seriesName: string; value: number; axisValue?: string }[]) => {
          const total = params.reduce((s, p) => s + p.value, 0)
          const lines = params
            .filter((p) => p.value > 0)
            .map((p) => `${p.seriesName}: <b>${p.value.toLocaleString()}</b>`)
          return [`<b>${params[0]?.axisValue ?? ''}</b>`, ...lines, `Total: <b>${total.toLocaleString()}</b>`].join('<br/>')
        },
      },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1e1e1e' } },
        axisLabel: {
          color: '#666',
          fontSize: 10,
          fontFamily: FONT,
          formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
        },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLabel: {
          color: '#ccc',
          fontSize: 11,
          fontFamily: FONT,
          interval: 0,        // force all labels to render
          overflow: 'truncate',
          width: 118,
        },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
        axisTick: { show: false },
      },
      series: [
        {
          name: 'Issues',
          type: 'bar',
          stack: 'total',
          data: issues,
          itemStyle: { color: '#4ade80' },
          emphasis: { focus: 'series' },
        },
        {
          name: 'PRs',
          type: 'bar',
          stack: 'total',
          data: prs,
          itemStyle: { color: '#FAFF69' },
          emphasis: { focus: 'series' },
        },
        {
          name: 'Comments',
          type: 'bar',
          stack: 'total',
          data: comments,
          itemStyle: { color: '#555', borderRadius: [0, 3, 3, 0] },
          emphasis: { focus: 'series' },
        },
      ],
    }
  }, [data])

  const onEvents = useMemo(() => ({
    click: (params: { name?: string }) => {
      if (params.name) window.open(`https://github.com/${params.name}`, '_blank')
    },
  }), [])

  return (
    <ReactECharts
      option={option}
      onEvents={onEvents}
      style={{ width: '100%', height: '100%' }}
      theme="dark"
    />
  )
}
