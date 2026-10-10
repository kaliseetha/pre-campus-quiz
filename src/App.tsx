import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  Copy,
  LockKeyhole,
  Medal,
  QrCode,
  Sparkles,
  X,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import './App.css'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { QuizState, Route } from './types'

const optionLetters = ['A', 'B', 'C', 'D']
const OrganizerPortal = lazy(() => import('./Organizer').then((module) => ({
  default: module.OrganizerPortal,
})))

function readRoute(): Route {
  if (window.location.pathname === '/organizer') return { page: 'organizer' }
  const params = new URLSearchParams(window.location.search)
  const hostCode = params.get('host')
  const joinCode = params.get('join')

  if (hostCode) return { page: 'host', code: hostCode.toUpperCase() }
  if (joinCode) return { page: 'join', code: joinCode.toUpperCase() }
  return { page: 'home' }
}

function navigate(route: Route) {
  if (route.page === 'organizer') {
    window.history.pushState({}, '', '/organizer')
    window.dispatchEvent(new PopStateEvent('popstate'))
    return
  }
  const params = new URLSearchParams()
  if (route.page !== 'home' && route.code) params.set(route.page, route.code)
  window.history.pushState({}, '', params.size ? `/?${params}` : '/')
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function App() {
  const [route, setRoute] = useState<Route>(readRoute)

  useEffect(() => {
    const onPopState = () => setRoute(readRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (!isSupabaseConfigured || !supabase) {
    return <ConfigurationScreen />
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate({ page: 'home' })}>
          <span className="brand-mark"><Sparkles size={18} /></span>
          Campus Quiz
        </button>
        {route.page === 'home' ? (
          <button className="text-link" onClick={() => navigate({ page: 'organizer' })}>
            Organizer sign in
          </button>
        ) : (
          <span className="topbar-note">Pre-campus drive · live quiz</span>
        )}
      </header>
      {route.page === 'host' && route.code ? (
        <HostSession code={route.code} />
      ) : route.page === 'join' && route.code ? (
        <PlayerSession code={route.code} />
      ) : route.page === 'organizer' ? (
        <Suspense fallback={<main className="page-wrap join-screen"><div className="spinner" /></main>}>
          <OrganizerPortal
            onNavigateHome={() => navigate({ page: 'home' })}
            onHostSession={(code) => navigate({ page: 'host', code })}
          />
        </Suspense>
      ) : (
        <StudentHome />
      )}
      <footer className="site-footer">
        <span>Developed By Kalidasan Seetharaman</span>
        <a href="https://github.com/kaliseetha/pre-campus-quiz" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  )
}

function ConfigurationScreen() {
  return (
    <main className="config-screen">
      <section className="config-card card">
        <span className="brand-mark"><Sparkles size={18} /></span>
        <h1>Connect your quiz backend</h1>
        <p>
          Add your Supabase project URL and publishable key to a <code>.env.local</code>
          file in the project root, then restart the Vite development server.
        </p>
        <pre><code>VITE_SUPABASE_URL=https://your-project.supabase.co{'\n'}VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key</code></pre>
        <p>
          These browser-side values are publishable keys, not service-role secrets.
          Keep all service-role keys out of the React app.
        </p>
      </section>
    </main>
  )
}

function StudentHome() {
  const [joinCode, setJoinCode] = useState('')

  function openJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (code) navigate({ page: 'join', code })
  }

  return (
    <main className="page-wrap join-screen">
      <section className="card join-card student-entry">
        <div className="join-heading">
          <span className="brand-mark"><QrCode size={19} /></span>
          <div className="step-label" style={{ justifyContent: 'center' }}>Pre-campus drive quiz</div>
          <h1>Ready to join?</h1>
          <p>Scan the QR code shown by your organizer to open the quiz. If you can’t scan it, enter the room code below.</p>
        </div>
        <div className="student-scan-note">
          <QrCode size={25} />
          <div><strong>Scan the organizer’s QR code</strong><span>Your camera will take you straight to the quiz room.</span></div>
        </div>
        <form onSubmit={openJoin}>
          <div className="field">
            <label htmlFor="join-code">Or enter the room code</label>
            <input id="join-code" autoComplete="off" placeholder="e.g. 4F8A2C" maxLength={6} value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} required />
          </div>
          <button className="primary-button wide-button" type="submit">
            Continue to quiz <ArrowRight size={16} />
          </button>
        </form>
        <p className="student-privacy"><LockKeyhole size={13} /> Your answers are private until the quiz ends.</p>
      </section>
    </main>
  )
}

function HostSession({ code }: { code: string }) {
  const [quiz, setQuiz] = useState<QuizState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const joinUrl = useMemo(() => `${window.location.origin}/?join=${encodeURIComponent(code)}`, [code])

  const refresh = useCallback(async () => {
    if (!supabase) return
    const { data, error: stateError } = await supabase.rpc('quiz_get_state', { p_code: code })
    if (stateError) {
      setError(stateError.message)
      return
    }
    setQuiz(data as QuizState)
    setError('')
  }, [code])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(timer)
    }
  }, [refresh])

  async function startQuiz() {
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error: startError } = await supabase.rpc('quiz_start', { p_code: code })
    if (startError) setError(startError.message)
    else await refresh()
    setBusy(false)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy the link. You can copy it from the address shown under the QR code.')
    }
  }

  async function deleteResults() {
    if (!supabase || !window.confirm('Delete this finished quiz and all participant names and answers? This cannot be undone.')) return
    setBusy(true)
    setError('')
    const { error: deleteError } = await supabase.rpc('quiz_delete', { p_code: code })
    if (deleteError) {
      setError(deleteError.message)
      setBusy(false)
      return
    }
    navigate({ page: 'home' })
  }

  return (
    <main className="page-wrap">
      <div className="host-layout">
        <section className="host-main">
          <section className="card card-pad">
            <div className="host-title-row">
              <div>
                <div className="step-label"><span className="step-number">●</span> Organizer room</div>
                <h1>{quiz?.title ?? 'Your quiz room'}</h1>
                <p className="card-subtitle">Share the QR code or room code. Students can join while the quiz is running.</p>
              </div>
              {quiz && <span className="status-pill"><span className="status-dot" />{statusLabel(quiz.status)}</span>}
            </div>
            {quiz && (
              <>
                <div className="stat-row">
                  <div className="stat-tile"><span>Players joined</span><strong>{quiz.participant_count}<small> / 49</small></strong></div>
                  <div className="stat-tile"><span>Questions</span><strong>{quiz.question_count}</strong></div>
                  <div className="stat-tile"><span>Room code</span><strong style={{ letterSpacing: 2 }}>{quiz.code}</strong></div>
                </div>
                {quiz.status === 'waiting' && (
                  <button className="primary-button" style={{ marginTop: 20 }} onClick={() => void startQuiz()} disabled={busy || quiz.participant_count === 0}>
                    {busy ? 'Starting…' : 'Start the timed quiz'} <ArrowRight size={16} />
                  </button>
                )}
                {quiz.status === 'waiting' && quiz.participant_count === 0 && (
                  <p className="card-subtitle" style={{ marginTop: 10 }}>The quiz will start once at least one player has joined.</p>
                )}
                {quiz.current_question && quiz.status === 'active' && (
                  <div className="question-active" style={{ marginTop: 20 }}>
                    <div className="question-active-top">
                      <span>Question {quiz.current_question.question_no} of {quiz.question_count}</span>
                      <span><Clock3 size={14} /> {quiz.current_question.seconds_remaining}s left</span>
                    </div>
                    <h2>{quiz.current_question.prompt}</h2>
                    <div className="timer-track">
                      <span style={{ width: `${Math.max(0, (quiz.current_question.seconds_remaining / quiz.current_question.seconds) * 100)}%` }} />
                    </div>
                  </div>
                )}
                {quiz.status === 'finished' && <Podium results={quiz.top_three} />}
              </>
            )}
            {error && <div className="error-message"><X size={15} />{error}</div>}
          </section>
          {quiz?.status === 'finished' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
              <button className="text-link" onClick={() => navigate({ page: 'home' })}><ArrowLeft size={14} /> Create another quiz</button>
              <button className="text-link" style={{ color: '#a84031' }} onClick={() => void deleteResults()} disabled={busy}>
                <X size={14} /> Delete quiz and results
              </button>
            </div>
          )}
        </section>

        <aside className="card qr-card">
          <h3>Invite your players</h3>
          <p>Point a phone camera at this QR code<br />to join the room.</p>
          <div className="qr-frame"><QRCodeSVG value={joinUrl} size={166} level="M" /></div>
          <div className="host-code">Room code <strong>{code}</strong></div>
          <button className="secondary-button wide-button" onClick={() => void copyLink()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Link copied' : 'Copy join link'}
          </button>
          <span className="qr-url">{joinUrl}</span>
        </aside>
      </div>
    </main>
  )
}

function PlayerSession({ code }: { code: string }) {
  const [name, setName] = useState(() => sessionStorage.getItem(`quiz-name-${code}`) ?? '')
  const [joined, setJoined] = useState(false)
  const [quiz, setQuiz] = useState<QuizState | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(0)

  const refresh = useCallback(async () => {
    if (!supabase) return
    const { data, error: stateError } = await supabase.rpc('quiz_get_state', { p_code: code })
    if (stateError) {
      setError(stateError.message)
      return
    }
    const next = data as QuizState
    setQuiz(next)
    setError('')
    if (next.current_question?.question_no !== quiz?.current_question?.question_no) {
      setSelected(null)
    }
  }, [code, quiz?.current_question?.question_no])

  useEffect(() => {
    let cancelled = false
    async function restorePlayer() {
      if (!supabase) return
      const savedName = sessionStorage.getItem(`quiz-name-${code}`)
      if (!savedName) return
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) {
        const { error: authError } = await supabase.auth.signInAnonymously()
        if (authError) {
          if (!cancelled) setError(authError.message)
          return
        }
      }
      const { error: joinError } = await supabase.rpc('quiz_join', {
        p_code: code,
        p_display_name: savedName,
      })
      if (!cancelled && !joinError) {
        setName(savedName)
        setJoined(true)
      } else if (!cancelled && joinError) {
        setError(joinError.message)
      }
    }
    void restorePlayer()
    return () => { cancelled = true }
  }, [code])

  useEffect(() => {
    if (!joined) return
    const initialRefresh = window.setTimeout(() => void refresh(), 0)
    const poll = window.setInterval(() => void refresh(), 2000)
    const initialClock = window.setTimeout(() => setNow(Date.now()), 0)
    const clock = window.setInterval(() => setNow(Date.now()), 250)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearTimeout(initialClock)
      window.clearInterval(poll)
      window.clearInterval(clock)
    }
  }, [joined, refresh])

  async function joinQuiz(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    try {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) {
        const { error: authError } = await supabase.auth.signInAnonymously()
        if (authError) throw authError
      }
      const cleanName = name.trim()
      const { error: joinError } = await supabase.rpc('quiz_join', {
        p_code: code,
        p_display_name: cleanName,
      })
      if (joinError) throw joinError
      sessionStorage.setItem(`quiz-name-${code}`, cleanName)
      setJoined(true)
      await refresh()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  async function submitAnswer() {
    if (!supabase || selected === null || !quiz?.current_question) return
    setBusy(true)
    setError('')
    const { data, error: answerError } = await supabase.rpc('quiz_submit_answer', {
      p_code: code,
      p_question_no: quiz.current_question.question_no,
      p_selected_index: selected,
    })
    if (answerError) {
      setError(answerError.message)
    } else if ((data as { accepted?: boolean }).accepted === false) {
      setError('Your answer was not accepted. This question may have timed out or already been answered.')
    } else {
      await refresh()
    }
    setBusy(false)
  }

  if (!joined) {
    return (
      <main className="page-wrap join-screen">
        <section className="card join-card">
          <div className="join-heading">
            <span className="brand-mark"><QrCode size={18} /></span>
            <div className="step-label" style={{ justifyContent: 'center' }}>You’re invited</div>
            <h1>Join the quiz</h1>
            <p>Choose the name you’d like on the leaderboard.<br />You can join even after a question has started.</p>
          </div>
          <form onSubmit={joinQuiz}>
            <div className="field">
              <label htmlFor="player-name">Your display name</label>
              <input
                id="player-name"
                autoComplete="nickname"
                maxLength={32}
                placeholder="e.g. Asha"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <button className="primary-button wide-button" type="submit" disabled={busy}>
              {busy ? 'Joining…' : 'Join room'} <ArrowRight size={16} />
            </button>
          </form>
          {error && <div className="error-message"><X size={15} />{error}</div>}
        </section>
      </main>
    )
  }

  const question = quiz?.current_question
  const secondsLeft = question
    ? Math.max(0, Math.ceil((new Date(question.ends_at).getTime() - now) / 1000))
    : 0

  return (
    <main className="page-wrap join-screen">
      <section className="card join-card">
        <div className="join-heading">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <div className="step-label" style={{ justifyContent: 'center' }}>{quiz?.title ?? 'Campus Quiz'}</div>
          {quiz?.status === 'waiting' && (
            <>
              <h1>You’re in, {name}!</h1>
              <p>Waiting for the organizer to start. You can keep this page open.</p>
              <div className="waiting-panel" style={{ marginTop: 22 }}>
                <div className="spinner" />
                <strong>Room {code}</strong>
                <p>{quiz.participant_count} player{quiz.participant_count === 1 ? '' : 's'} in the room</p>
              </div>
            </>
          )}
          {quiz?.status === 'finished' && (
            <>
              <h1>That’s a wrap!</h1>
              <p>Thanks for playing, {name}. Here are the top three.</p>
              <Podium results={quiz.top_three} />
            </>
          )}
        </div>

        {quiz?.status === 'active' && question && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 21 }}>
              <span className="player-count"><CircleHelp size={14} /> Question {question.question_no} of {quiz.question_count}</span>
              <span className={`question-timer${secondsLeft <= 5 ? ' low' : ''}`}><Clock3 size={15} /> {secondsLeft}s</span>
            </div>
            <h2 style={{ margin: '21px 0 0', fontFamily: 'Manrope, sans-serif', fontSize: 22, letterSpacing: '-.5px', lineHeight: 1.35 }}>{question.prompt}</h2>
            <div className="join-options">
              {question.options.map((option, index) => (
                <button
                  className={`answer-option${selected === index ? ' selected' : ''}`}
                  key={`${index}-${option}`}
                  onClick={() => setSelected(index)}
                  disabled={question.already_answered || secondsLeft === 0}
                >
                  <span className="option-letter">{optionLetters[index]}</span>{option}
                  {selected === index && <Check size={17} style={{ marginLeft: 'auto', color: '#176c56' }} />}
                </button>
              ))}
            </div>
            {question.already_answered ? (
              <div className="success-message"><Check size={15} />Answer received. Good luck!</div>
            ) : (
              <button className="primary-button wide-button" onClick={() => void submitAnswer()} disabled={selected === null || busy || secondsLeft === 0}>
                {busy ? 'Submitting…' : 'Lock in answer'} <ArrowRight size={15} />
              </button>
            )}
            <p className="card-subtitle" style={{ textAlign: 'center', marginTop: 13 }}>Next question loads automatically when the timer ends.</p>
          </>
        )}
        {quiz?.status === 'active' && !question && (
          <div className="waiting-panel" style={{ marginTop: 22 }}>
            <div className="spinner" />
            <strong>Loading the next question</strong>
            <p>Hang tight — your quiz is in progress.</p>
          </div>
        )}
        {error && <div className="error-message"><X size={15} />{error}</div>}
      </section>
    </main>
  )
}

function Podium({ results }: { results: QuizState['top_three'] }) {
  return (
    <section style={{ marginTop: 22 }}>
      <div className="step-label" style={{ justifyContent: 'center' }}><Medal size={15} /> Final leaderboard</div>
      {results.length === 0 ? (
        <p className="card-subtitle" style={{ marginTop: 16, textAlign: 'center' }}>No scores were recorded this time.</p>
      ) : (
        <div className="results-list">
          {results.map((result, index) => (
            <div className="result-row" key={`${result.display_name}-${index}`}>
              <span className="medal">{['🥇', '🥈', '🥉'][index]}</span>
              <strong>{result.display_name}</strong>
              <span className="result-score">{result.score} pts</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function statusLabel(status: QuizState['status']) {
  if (status === 'waiting') return 'Waiting to start'
  if (status === 'finished') return 'Quiz finished'
  return 'Quiz live'
}

export default App
