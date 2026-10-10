import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  FileSpreadsheet,
  LockKeyhole,
  Sparkles,
  Trophy,
  Users,
  Upload,
  X,
} from 'lucide-react'
import './App.css'
import { downloadCsvTemplate, parseQuestionsCsv } from './lib/questions'
import { supabase } from './lib/supabase'
import type { QuizQuestionInput } from './types'

const optionLetters = ['A', 'B', 'C', 'D']

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export function OrganizerPortal({
  onNavigateHome,
  onHostSession,
}: {
  onNavigateHome: () => void
  onHostSession: (code: string) => void
}) {
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const checkOrganizer = useCallback(async () => {
    if (!supabase) return
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError) {
      setError(authError.message)
      setAuthorized(false)
      setChecking(false)
      return
    }
    if (!authData.user) {
      setAuthorized(false)
      setChecking(false)
      return
    }
    const { data, error: roleError } = await supabase.rpc('quiz_is_organizer')
    if (roleError) {
      setError(roleError.message)
      setAuthorized(false)
    } else {
      setAuthorized(data === true)
      setError(data === true ? '' : 'This account is not registered as a quiz organizer.')
    }
    setChecking(false)
  }, [])

  useEffect(() => {
    const initialCheck = window.setTimeout(() => void checkOrganizer(), 0)
    return () => window.clearTimeout(initialCheck)
  }, [checkOrganizer])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (signInError) {
      setError(signInError.message)
      setBusy(false)
      return
    }
    await checkOrganizer()
    setBusy(false)
  }

  async function signOut() {
    if (!supabase) return
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setError(signOutError.message)
      return
    }
    setAuthorized(false)
    setEmail('')
    setPassword('')
    setError('')
  }

  if (checking) {
    return <main className="page-wrap join-screen"><div className="spinner" /></main>
  }

  if (authorized) {
    return (
      <OrganizerConsole
        onSignOut={() => void signOut()}
        onHostSession={onHostSession}
      />
    )
  }

  return (
    <main className="page-wrap join-screen">
      <section className="card join-card">
        <div className="join-heading">
          <span className="brand-mark"><LockKeyhole size={18} /></span>
          <div className="step-label" style={{ justifyContent: 'center' }}>Organizer access</div>
          <h1>Sign in to set up a quiz</h1>
          <p>Only registered organizers can upload questions or manage quiz rooms.</p>
        </div>
        <form onSubmit={signIn}>
          <div className="field">
            <label htmlFor="organizer-email">Organizer email</label>
            <input id="organizer-email" type="email" autoComplete="username" placeholder="you@college.edu" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="organizer-password">Password</label>
            <input id="organizer-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          <button className="primary-button wide-button" type="submit" disabled={busy}>
            {busy ? 'Checking organizer access…' : 'Sign in'} <ArrowRight size={16} />
          </button>
        </form>
        {error && <div className="error-message"><X size={15} />{error}</div>}
        <button className="text-link" style={{ marginTop: 18 }} onClick={onNavigateHome}>
          <ArrowLeft size={14} /> Back to student join
        </button>
      </section>
    </main>
  )
}

function OrganizerConsole({
  onSignOut,
  onHostSession,
}: {
  onSignOut: () => void
  onHostSession: (code: string) => void
}) {
  const [questions, setQuestions] = useState<QuizQuestionInput[]>([])
  const [fileName, setFileName] = useState('')
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [title, setTitle] = useState('Pre-campus drive quiz')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onFileSelected(file?: File) {
    setImportErrors([])
    setQuestions([])
    setFileName('')
    setError('')
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setImportErrors(['Please choose a .csv file.'])
      return
    }

    const result = await parseQuestionsCsv(file)
    setFileName(file.name)
    setQuestions(result.questions)
    setImportErrors(result.errors)
  }

  async function createQuiz(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    if (questions.length === 0 || importErrors.length > 0) {
      setError('Upload a valid CSV with at least one question before continuing.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const { data, error: createError } = await supabase.rpc('quiz_create', {
        p_title: title.trim(),
        p_questions: questions,
      })
      if (createError) throw createError
      if (typeof data !== 'string' || !data) {
        throw new Error('The quiz was created but the session code was not returned.')
      }
      onHostSession(data)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page-wrap">
      <div className="organizer-toolbar">
        <div><div className="step-label"><LockKeyhole size={14} /> Organizer workspace</div><p className="card-subtitle">Question upload and room controls are private to organizers.</p></div>
        <button className="secondary-button" onClick={onSignOut}>Sign out</button>
      </div>
      <section className="hero">
        <div className="hero-content">
          <span className="eyebrow"><Sparkles size={14} /> The room is yours</span>
          <h1>Set up a great quiz for your campus visit.</h1>
          <p>Upload your questions, share the room QR code, and reveal the top three when time is up.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="quiz-orbit">
            <span className="orbit-dot one">A</span>
            <span className="orbit-dot two">B</span>
            <span className="orbit-dot three">C</span>
            <span className="quiz-orbit-center"><Trophy size={34} /></span>
          </div>
        </div>
      </section>

      <div className="setup-grid">
        <section className="card card-pad">
          <div className="card-heading">
            <div>
              <div className="step-label"><span className="step-number">1</span> Question setup</div>
              <h2>Load your questions</h2>
              <p className="card-subtitle">Import a CSV and preview the quiz before creating your session.</p>
            </div>
            <FileSpreadsheet size={21} color="#176c56" />
          </div>
          <label className="upload-box">
            <Upload size={23} />
            <strong>Choose your quiz CSV</strong>
            <span>Four answer choices per question · 5 to 300 seconds each</span>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void onFileSelected(event.target.files?.[0])} />
          </label>
          <button className="text-link template-link" onClick={downloadCsvTemplate}>
            <FileSpreadsheet size={14} /> Download the CSV template
          </button>
          {importErrors.length > 0 && (
            <div className="error-message">
              <X size={15} />
              <div>{importErrors.map((item) => <div key={item}>{item}</div>)}</div>
            </div>
          )}
          {questions.length > 0 && importErrors.length === 0 && (
            <>
              <div className="import-meta">
                <span><Check size={14} /> {fileName}</span>
                <strong>{questions.length} question{questions.length === 1 ? '' : 's'} ready</strong>
              </div>
              <p className="card-subtitle">Review the question, all choices, and correct answer before creating the room.</p>
              <ol className="question-preview">
                {questions.map((question, index) => (
                  <li className="preview-item" key={`${question.prompt}-${index}`}>
                    <span className="preview-index">{index + 1}</span>
                    <span className="preview-prompt" title={question.prompt}>{question.prompt}</span>
                    <span className="preview-timer">{question.seconds}s</span>
                    <span className="preview-detail">
                      {question.options.map((option, optionIndex) => `${optionLetters[optionIndex]}. ${option}`).join(' · ')}
                      {' · '}Correct: {optionLetters[question.correctIndex]}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <form onSubmit={createQuiz}>
            <div className="field">
              <label htmlFor="quiz-title">Quiz title</label>
              <input id="quiz-title" maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} required />
            </div>
            <button className="primary-button wide-button" type="submit" disabled={busy || questions.length === 0 || importErrors.length > 0}>
              {busy ? 'Creating your room…' : 'Create quiz room'} <ArrowRight size={16} />
            </button>
          </form>
          {error && <div className="error-message"><X size={15} />{error}</div>}
        </section>
        <aside>
          <section className="card info-card">
            <h3>Ready for game day</h3>
            <ul className="info-list">
              <li><span className="info-icon"><Clock3 size={17} /></span><div><strong>Timed, automatic rounds</strong><span>Each question advances when its timer runs out. Late arrivals join the current round.</span></div></li>
              <li><span className="info-icon"><Users size={17} /></span><div><strong>Up to 49 players</strong><span>Each student joins individually from their phone with a display name.</span></div></li>
              <li><span className="info-icon"><Trophy size={17} /></span><div><strong>Top three at the finish</strong><span>Scores are checked on the server; the final screen celebrates the podium.</span></div></li>
              <li><span className="info-icon"><LockKeyhole size={17} /></span><div><strong>Answers stay private</strong><span>Correct answers are never sent to players during the quiz.</span></div></li>
            </ul>
          </section>
        </aside>
      </div>
    </main>
  )
}
