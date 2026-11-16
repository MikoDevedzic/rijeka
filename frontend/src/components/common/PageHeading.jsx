// common/PageHeading.jsx — the page's first heading (lib/a11y.js pageName), for a reader who does not see the page.
import { useLocation } from 'react-router-dom'
import { pageName } from '../../lib/a11y'

// The page's first heading, read by a screen reader and not drawn: the top bar already shows where you are.
export default function PageHeading() {
  const { pathname } = useLocation()
  const name = pageName(pathname)
  return name ? <h1 className="rj-sr" data-testid="page-heading">{name}</h1> : null
}
