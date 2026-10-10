import Papa from 'papaparse'
import type { QuizQuestionInput } from '../types'

export type QuestionImport = {
  questions: QuizQuestionInput[]
  errors: string[]
}

const expectedColumns = [
  'question',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'correct_answer',
  'seconds',
]

export function parseQuestionsCsv(file: File): Promise<QuestionImport> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim().toLowerCase(),
      complete: ({ data, errors, meta }) => {
        const importErrors = errors.map((error) => {
          const row = error.row === undefined ? '' : `CSV row ${error.row + 2}: `
          return `${row}${error.message}`
        })
        const columns = meta.fields ?? []
        const missingColumns = expectedColumns.filter(
          (column) => !columns.includes(column),
        )

        if (missingColumns.length > 0) {
          resolve({
            questions: [],
            errors: [
              `Missing required column${missingColumns.length > 1 ? 's' : ''}: ${missingColumns.join(', ')}.`,
              'Use the downloadable CSV template and keep its header row.',
            ],
          })
          return
        }

        if (data.length === 0) {
          importErrors.push('The CSV does not contain any question rows.')
        }
        if (data.length > 50) {
          importErrors.push('A quiz can contain at most 50 questions.')
        }

        const questions = data.flatMap((row, index) => {
          const rowNumber = index + 2
          const prompt = row.question?.trim() ?? ''
          const options = ['a', 'b', 'c', 'd'].map(
            (letter) => row[`option_${letter}`]?.trim() ?? '',
          )
          const answerLetter = row.correct_answer?.trim().toLowerCase() ?? ''
          const seconds = Number(row.seconds)
          const rowErrors: string[] = []

          if (!prompt) rowErrors.push('question is blank')
          if (prompt.length > 1000) rowErrors.push('question is longer than 1,000 characters')
          if (options.some((option) => !option)) {
            rowErrors.push('all four options are required')
          }
          if (options.some((option) => option.length > 500)) {
            rowErrors.push('answer options must be 500 characters or fewer')
          }
          if (!['a', 'b', 'c', 'd'].includes(answerLetter)) {
            rowErrors.push('correct_answer must be A, B, C, or D')
          }
          if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300) {
            rowErrors.push('seconds must be a whole number from 5 to 300')
          }

          if (rowErrors.length > 0) {
            importErrors.push(`CSV row ${rowNumber}: ${rowErrors.join('; ')}.`)
            return []
          }

          return [{
            prompt,
            options,
            correctIndex: answerLetter.charCodeAt(0) - 97,
            seconds,
          }]
        })

        resolve({ questions, errors: importErrors })
      },
    })
  })
}

export function downloadCsvTemplate() {
  const csv = [
    'question,option_a,option_b,option_c,option_d,correct_answer,seconds',
    '"What is the capital of France?","Paris","Rome","Madrid","Berlin","A",20',
    '"Which data structure uses FIFO?","Stack","Queue","Tree","Graph","B",30',
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'campus-quiz-questions-template.csv'
  link.click()
  URL.revokeObjectURL(url)
}
