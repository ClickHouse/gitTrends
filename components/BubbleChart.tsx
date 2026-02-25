'use client'

import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'

interface RepoRow {
  repo_name: string
  mentions: string
}

interface BubbleChartProps {
  data: RepoRow[]
  onSelect: (repo: string) => void
  selectedRepo: string | null
}

export default function BubbleChart({ data, onSelect, selectedRepo }: BubbleChartProps) {
  const option = useMemo(() => {
    const maxMentions = Math.max(...data.map((d) => Number(d.mentions)))

    const seriesData = data.map((d) => ({
      name: d.repo_name,
      value: [
        // Spread repos across x-axis by hash
        ((d.repo_name.charCodeAt(0) * 37 + d.repo_name.charCodeAt(Math.floor(d.repo_name.length / 2)) * 17) % 100),
        ((d.repo_name.charCodeAt(d.repo_name.length - 1) * 53 + d.repo_name.length * 29) % 100),
        Number(d.mentions),
      ],
      label: {
        show: true,
        formatter: (p: { name: string }) => {
          const parts = p.name.split('/')
          return parts[parts.length - 1]
        },
        color: '#e5e5e5',
        fontSize: 11,
        fontFamily: 'Inter',
      },
      itemStyle: {
        color: d.repo_name === selectedRepo ? '#FAFF69' : '#FAFF6966',
        borderColor: d.repo_name === selectedRepo ? '#FAFF69' : '#FAFF6999',
        borderWidth: d.repo_name === selectedRepo ? 2 : 1,
      },
    }))

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1a1a1a',
        borderColor: '#2a2a2a',
        textStyle: { color: '#e5e5e5', fontFamily: 'Inter' },
        formatter: (p: { name: string; value: number[] }) =>
          `<b>${p.name}</b><br/>${Number(p.value[2]).toLocaleString()} mentions`,
      },
      xAxis: {
        show: false,
        min: -5,
        max: 105,
      },
      yAxis: {
        show: false,
        min: -5,
        max: 105,
      },
      series: [
        {
          type: 'scatter',
          data: seriesData,
          symbolSize: (val: number[]) => {
            const size = Math.sqrt(val[2] / maxMentions) * 90 + 20
            return Math.min(size, 120)
          },
          emphasis: {
            scale: true,
            itemStyle: {
              color: '#FAFF69',
              borderColor: '#fff',
              borderWidth: 2,
            },
          },
        },
      ],
    }
  }, [data, selectedRepo])

  const onEvents = {
    click: (params: { name: string }) => {
      onSelect(params.name)
    },
  }

  return (
    <ReactECharts
      option={option}
      onEvents={onEvents}
      style={{ width: '100%', height: '100%' }}
      theme="dark"
    />
  )
}
