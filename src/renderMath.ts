import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Marked } from 'marked'

const tex = (source: string, displayMode: boolean) => katex.renderToString(source, { displayMode, throwOnError: false })
const escaped = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * mathspec's Markdown as HTML: `` $`…`$ `` inline and ```` ```math ```` blocks through KaTeX.
 *
 * A spec's descriptions reach this text verbatim, and a published archive is someone else's file, so raw HTML is
 * shown as text and a link as its words alone.
 */
const markdown = new Marked({
  extensions: [
    {
      name: 'inlineMath',
      level: 'inline',
      start: (src: string) => src.indexOf('$`'),
      tokenizer(src: string) {
        const found = /^\$`([^`]+)`\$/.exec(src)
        return found ? { type: 'inlineMath', raw: found[0], text: found[1] } : undefined
      },
      renderer: (token) => tex(token.text as string, false),
    },
  ],
  renderer: {
    code: ({ text, lang }) => (lang === 'math' ? tex(text, true) : false),
    html: ({ text }) => escaped(text),
    link({ tokens }) {
      return this.parser.parseInline(tokens)
    },
    image: ({ text }) => escaped(text),
  },
})

/** *text*, mathspec's Markdown, as HTML with its math typeset. */
export const renderMath = (text: string): string => markdown.parse(text) as string
