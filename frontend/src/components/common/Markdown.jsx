import { marked } from 'marked'
import DOMPurify from 'dompurify'
import './Markdown.css'

// Model output is untrusted: parse with marked, then sanitise every render.
marked.setOptions({ gfm: true, breaks: true })
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export default function Markdown({ text, className = 'pm-md' }) {
  const html = DOMPurify.sanitize(marked.parse(text || ''))
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
