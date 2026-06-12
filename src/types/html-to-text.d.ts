declare module 'html-to-text' {
  interface HtmlToTextOptions {
    wordwrap?: number | false
    selectors?: Array<{
      selector: string
      format: string
    }>
  }
  export function htmlToText(html: string, options?: HtmlToTextOptions): string
}
