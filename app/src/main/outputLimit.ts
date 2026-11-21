export const OUTPUT_LIMIT_MESSAGE = '출력 한도로 정리가 중단되었습니다. 이전 요약을 보존했습니다.'

/** A partial answer is evidence for explicit continuation, never a completed saved note. */
export class OutputLimitError extends Error {
  readonly partial: string
  constructor(partial: string) {
    super(OUTPUT_LIMIT_MESSAGE)
    this.name = 'OutputLimitError'
    this.partial = partial
    Object.defineProperty(this, 'partial', { enumerable: false })
  }
}
