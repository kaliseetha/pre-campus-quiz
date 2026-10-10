export type QuizQuestionInput = {
  prompt: string
  options: string[]
  correctIndex: number
  seconds: number
}

export type QuizQuestion = {
  question_no: number
  prompt: string
  options: string[]
  seconds: number
  ends_at: string
  seconds_remaining: number
  already_answered: boolean
}

export type QuizResult = {
  display_name: string
  score: number
}

export type QuizState = {
  code: string
  title: string
  status: 'waiting' | 'active' | 'finished'
  participant_count: number
  question_count: number
  current_question: QuizQuestion | null
  top_three: QuizResult[]
}

export type Route = {
  page: 'home' | 'organizer' | 'host' | 'join'
  code?: string
}
