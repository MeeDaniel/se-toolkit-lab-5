import { useState, useEffect } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
)

const STORAGE_KEY = 'api_key'

interface ScoreBucket {
  bucket: string
  count: number
}

interface TimelineEntry {
  date: string
  submissions: number
}

interface PassRate {
  task: string
  avg_score: number
  attempts: number
}

interface Lab {
  id: string
  title: string
}

interface DashboardData {
  scores: ScoreBucket[]
  timeline: TimelineEntry[]
  passRates: PassRate[]
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: DashboardData }
  | { status: 'error'; message: string }

const AVAILABLE_LABS: Lab[] = [
  { id: 'lab-03', title: 'Lab 03' },
  { id: 'lab-04', title: 'Lab 04' },
]

function Dashboard() {
  const [token] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '')
  const [selectedLab, setSelectedLab] = useState<string>(AVAILABLE_LABS[0]?.id ?? 'lab-04')
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' })

  useEffect(() => {
    if (!token) {
      setFetchState({ status: 'error', message: 'No API token found' })
      return
    }

    setFetchState({ status: 'loading' })

    const headers = { Authorization: `Bearer ${token}` }

    const buildUrl = (endpoint: string, lab: string): string => {
      return `${endpoint}?lab=${encodeURIComponent(lab)}`
    }

    Promise.all([
      fetch(buildUrl('/analytics/scores', selectedLab), { headers }),
      fetch(buildUrl('/analytics/timeline', selectedLab), { headers }),
      fetch(buildUrl('/analytics/pass-rates', selectedLab), { headers }),
    ])
      .then(async ([scoresRes, timelineRes, passRatesRes]) => {
        if (!scoresRes.ok) throw new Error(`Scores: HTTP ${scoresRes.status}`)
        if (!timelineRes.ok) throw new Error(`Timeline: HTTP ${timelineRes.status}`)
        if (!passRatesRes.ok) throw new Error(`Pass rates: HTTP ${passRatesRes.status}`)

        return Promise.all([
          scoresRes.json() as Promise<ScoreBucket[]>,
          timelineRes.json() as Promise<TimelineEntry[]>,
          passRatesRes.json() as Promise<PassRate[]>,
        ])
      })
      .then(([scores, timeline, passRates]) => {
        setFetchState({ status: 'success', data: { scores, timeline, passRates } })
      })
      .catch((err: Error) => {
        setFetchState({ status: 'error', message: err.message })
      })
  }, [token, selectedLab])

  if (!token) {
    return (
      <div className="dashboard">
        <h1>Dashboard</h1>
        <p>Please set your API key to view analytics.</p>
      </div>
    )
  }

  if (fetchState.status === 'loading') {
    return (
      <div className="dashboard">
        <h1>Dashboard</h1>
        <p>Loading...</p>
      </div>
    )
  }

  if (fetchState.status === 'error') {
    return (
      <div className="dashboard">
        <h1>Dashboard</h1>
        <p className="error">Error: {fetchState.message}</p>
      </div>
    )
  }

  if (fetchState.status !== 'success') {
    return null
  }

  const { scores, timeline, passRates } = fetchState.data

  const barChartData = {
    labels: scores.map((s: ScoreBucket) => s.bucket),
    datasets: [
      {
        label: 'Submissions',
        data: scores.map((s: ScoreBucket) => s.count),
        backgroundColor: 'rgba(54, 162, 235, 0.6)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
      },
    ],
  }

  const lineChartData = {
    labels: timeline.map((t: TimelineEntry) => t.date),
    datasets: [
      {
        label: 'Submissions per day',
        data: timeline.map((t: TimelineEntry) => t.submissions),
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.3,
        fill: true,
      },
    ],
  }

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Analytics',
      },
    },
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Dashboard — {AVAILABLE_LABS.find((l) => l.id === selectedLab)?.title}</h1>
        <select
          value={selectedLab}
          onChange={(e) => setSelectedLab(e.target.value)}
          className="lab-selector"
        >
          {AVAILABLE_LABS.map((lab) => (
            <option key={lab.id} value={lab.id}>
              {lab.title}
            </option>
          ))}
        </select>
      </header>

      <section className="chart-section">
        <h2>Score Distribution</h2>
        <Bar data={barChartData} options={chartOptions} />
      </section>

      <section className="chart-section">
        <h2>Submissions Timeline</h2>
        <Line data={lineChartData} options={chartOptions} />
      </section>

      <section className="table-section">
        <h2>Pass Rates per Task</h2>
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Avg Score</th>
              <th>Attempts</th>
            </tr>
          </thead>
          <tbody>
            {passRates.map((rate: PassRate) => (
              <tr key={rate.task}>
                <td>{rate.task}</td>
                <td>{rate.avg_score.toFixed(1)}</td>
                <td>{rate.attempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

export default Dashboard
