import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import ErrorBoundary    from './components/ErrorBoundary'
import Loading          from './components/common/Loading'
import NewVersionBar from './components/common/NewVersionBar'
import { hit } from './lib/usage'
import { useModulesStore, ROUTE_MODULES } from './store/useModulesStore'
import { useAuthStore } from './store/useAuthStore'
import AuthGuard        from './components/auth/AuthGuard'
import LoginPage        from './components/auth/LoginPage'
import SignupPage       from './components/auth/SignupPage'
import ConfirmPage      from './components/auth/ConfirmPage'
import ResetPage        from './components/auth/ResetPage'
import CommandCenter    from './components/CommandCenter'
import AppBar           from './components/layout/AppBar'
import CfgNav           from './components/layout/CfgNav'
import BlotterShell     from './components/blotter/BlotterShell'
import TradeWindow        from './components/trade-window/TradeWindow'
import useBookingStore    from './store/useBookingStore'
import Messenger, { MessengerPage } from './components/messenger/Messenger'

// Everything a user does not meet on the first screen after sign-in is fetched when
// first visited (React.lazy): the configuration pages, market data, docs, P&L, risk
// and counterparty credit. Nothing below has an effect
// at import time, so the order modules load in does not matter; the realtime stores
// (trades, chat, market data) are imported by the eager shell above and start where
// they always did. A named export is adapted to the default React.lazy expects.
const named = (load, name) => lazy(() => load().then(m => ({ default: m[name] })))
const PnlPage           = lazy(() => import('./components/pnl/PnlPage'))
const BookingDefaults   = named(() => import('./components/pnl/PnlSettings'), 'BookingDefaults')
const PnlConventions    = named(() => import('./components/pnl/PnlSettings'), 'PnlConventions')
const RiskPage          = lazy(() => import('./components/risk/RiskPage'))
const CcrPage           = lazy(() => import('./components/risk/CcrPage'))
const CapitalPage           = lazy(() => import('./components/risk/CapitalPage'))
const CollateralPage        = lazy(() => import('./components/risk/CollateralPage'))
const IpvPage           = lazy(() => import('./components/pnl/IpvPage'))
const XvaReservesPage           = lazy(() => import('./components/pnl/XvaReservesPage'))
const IpvTolerances           = lazy(() => import('./components/configurations/IpvTolerances'))
const LimitsPage        = named(() => import('./components/risk/RiskSettings'), 'LimitsPage')
const VarSettingsPage   = named(() => import('./components/risk/RiskSettings'), 'VarSettingsPage')
const StressCatalogue   = named(() => import('./components/risk/RiskSettings'), 'StressCatalogue')
const CurvesWorkspace   = lazy(() => import('./components/market-data/CurvesWorkspace'))
const SwaptionVolDetail = lazy(() => import('./components/market-data/SwaptionVolDetail'))
const CapVolDetail      = lazy(() => import('./components/market-data/CapVolDetail'))
const FxWorkspace       = lazy(() => import('./components/market-data/FxWorkspace'))
const OrgHierarchy      = lazy(() => import('./components/org/OrgHierarchy'))
const LegalEntities     = lazy(() => import('./components/onboarding/LegalEntities'))
const Counterparties    = lazy(() => import('./components/onboarding/Counterparties'))
const Methodology       = lazy(() => import('./components/docs/Methodology'))
const Roadmap           = lazy(() => import('./components/docs/Roadmap'))
const Terms             = named(() => import('./components/docs/Legal'), 'Terms')
const Privacy           = named(() => import('./components/docs/Legal'), 'Privacy')
const Users             = lazy(() => import('./components/admin/Users'))
const XVAParametersTab  = lazy(() => import('./components/configurations/XVAParametersTab'))
const SystemPage        = lazy(() => import('./components/configurations/SystemPage'))
const ModulesPage        = lazy(() => import('./components/configurations/ModulesPage'))
const CollateralInstruments = lazy(() => import('./components/configurations/CollateralInstruments'))

function BlotterLayout() {
  return (
    <div style={{display:'flex',height:'100vh',flexDirection:'column'}}>
      <AppBar />
      <div style={{flex:1,overflow:'hidden'}}><Suspense fallback={<Loading />}><AuthGuard /></Suspense></div>
    </div>
  )
}

function DocLayout() {
  return (
    <div style={{display:'flex',height:'100vh',flexDirection:'column'}}>
      <AppBar />
      <main style={{flex:1,overflow:'auto',background:'var(--bg)'}}><Suspense fallback={<Loading />}><AuthGuard /></Suspense></main>
    </div>
  )
}

function ConfigLayout() {
  return (
    <div style={{display:'flex',height:'100vh',flexDirection:'column'}}>
      <AppBar />
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        <CfgNav />
        <main style={{flex:1,overflow:'auto',background:'var(--bg)'}}><Suspense fallback={<Loading />}><AuthGuard /></Suspense></main>
      </div>
    </div>
  )
}


// Renders one trade window per entry in the booking store — survives navigation.
// A window with a trade shows that stored trade (read-only terms, revaluation,
// confirmation); one without is a new ticket for `productKey` (IR_SWAP unless
// the opener says otherwise). Both are the unified TradeWindow: the legacy
// TradeBookingWindow and its per-product localStorage gate were retired in the
// launch audit (batch C) once booking.js covered every rates product.
function PersistentBookingWindow() {
  const { windows, close } = useBookingStore()
  if (!windows.length) return null
  return (
    <>
      {windows.map(w => (
        <ErrorBoundary key={w.id} scope="window" onReset={() => close(w.id)}>
          <TradeWindow
            initialProduct={w.productKey || 'IR_SWAP'}
            initialTrade={w.trade || null}
            initialPos={{ x: w.x, y: w.y }}
            onClose={() => close(w.id)}
            onBook={() => {
              // No-op: booking.js::executeBooking books, and TradeWindow
              // refreshes useTradesStore / useTabStore itself after booking,
              // confirming and cancelling. Kept for the prop signature.
            }}
          />
        </ErrorBoundary>
      ))}
    </>
  )
}

// A page whose module the firm switched off sends the visitor home. Which modules a page needs is said once,
// in store/useModulesStore ROUTE_MODULES; `gated` makes the route for one of its paths.
// Nothing is drawn until the firm's switches have been answered (or the read has failed, which leaves every
// module on): a reload on a page whose module is off goes home without the page mounting and asking the API first.
function ModuleGate({ path, children }) {
  const modules = useModulesStore(s => s.modules)
  const loaded = useModulesStore(s => s.loaded)
  if (!loaded) return null
  if ((ROUTE_MODULES[path] || []).some(k => modules[k] === false)) return <Navigate to="/command-center" replace />
  return children
}
const gated = (path, page) => <Route path={path} element={<ModuleGate path={path}>{page}</ModuleGate>} />

// The Users page is for admins; everyone else lands on the configurations home.
function AdminOnly({ children }) {
  const { profile } = useAuthStore()
  if ((profile?.role || 'viewer') !== 'admin') return <Navigate to="/configurations" replace />
  return children
}

// The Modules page is for whoever may switch the firm's modules: an admin, or the user GET /api/modules marks
// can_edit (the owner of a sandbox workspace). On a reload the answer is still on its way, so wait for it
// rather than send away someone who is allowed in.
function ModuleEditors({ children }) {
  const { profile } = useAuthStore()
  const canEdit = useModulesStore(s => s.canEdit)
  const loaded  = useModulesStore(s => s.loaded)
  if (canEdit || profile?.role === 'admin') return children
  if (!loaded) return <Loading />
  return <Navigate to="/configurations" replace />
}

// A routed page that throws shows the error card; navigating elsewhere heals it.
// It also counts the view: one beacon per route change (lib/usage.js).
function PageBoundary({ children }) {
  const { pathname } = useLocation()
  useEffect(() => { hit('view', pathname) }, [pathname])
  return <ErrorBoundary scope="page" resetKey={pathname}>{children}</ErrorBoundary>
}

export default function App() {
  const { initAuth, loading } = useAuthStore()
  useEffect(() => { initAuth() }, [])
  if (loading) return (
    <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)',color:'var(--accent)',fontFamily:"'IBM Plex Mono',var(--mono)",fontSize:'0.875rem',letterSpacing:'0.15em'}}>
      INITIALISING...
    </div>
  )
  return (
    <BrowserRouter>
      <NewVersionBar />
      <PageBoundary>
      <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login"   element={<LoginPage />} />
        <Route path="/signup"  element={<SignupPage />} />
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="/reset"   element={<ResetPage />} />
        <Route path="/terms"   element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route element={<AuthGuard />}>
          <Route path="/command-center" element={<CommandCenter />} />
          {/* The messenger in its own window, to put on another screen. */}
          <Route path="/messenger" element={<MessengerPage />} />
          <Route element={<BlotterLayout />}>
            <Route path="/blotter" element={<BlotterShell />} />
            {gated('/pnl',             <PnlPage />)}
            {gated('/pnl/xva',         <XvaReservesPage />)}
            {gated('/pnl/ipv',         <IpvPage />)}
            {gated('/risk',            <RiskPage />)}
            {gated('/risk/ccr',        <CcrPage />)}
            {gated('/risk/capital',    <CapitalPage />)}
            {gated('/risk/collateral', <CollateralPage />)}
          </Route>
          <Route element={<DocLayout />}>
            <Route path="/methodology" element={<Methodology />} />
            <Route path="/roadmap"     element={<Roadmap />} />
          </Route>
          <Route element={<ConfigLayout />}>
            <Route path="/configurations">
              <Route index element={<Navigate to="market-data/curves" replace />} />
              <Route path="market-data/curves" element={<CurvesWorkspace />} />
              <Route path="org-hierarchy"      element={<OrgHierarchy />} />
              <Route path="pnl/defaults"       element={<BookingDefaults />} />
              <Route path="pnl/conventions"    element={<PnlConventions />} />
              <Route path="pnl/ipv-tolerances" element={<IpvTolerances />} />
              <Route path="market-risk/limits" element={<LimitsPage />} />
              <Route path="market-risk/var"    element={<VarSettingsPage />} />
              <Route path="market-risk/stress" element={<StressCatalogue />} />
              <Route path="legal-entities"     element={<LegalEntities />} />
              <Route path="counterparties"              element={<Counterparties />} />
              <Route path="collateral/instruments"      element={<CollateralInstruments />} />
              <Route path="market-data/swvol"            element={<SwaptionVolDetail />} />
              <Route path="market-data/capfloor"             element={<CapVolDetail />} />
              <Route path="market-data/crypto"               element={<FxWorkspace />} />
              <Route path="xva-parameters/hw1f"          element={<XVAParametersTab />} />
              <Route path="users"              element={<AdminOnly><Users /></AdminOnly>} />
              <Route path="system"             element={<SystemPage />} />
              <Route path="modules"            element={<ModuleEditors><ModulesPage /></ModuleEditors>} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/command-center" replace />} />
      </Routes>
      </Suspense>
      </PageBoundary>
      <PersistentBookingWindow />
      {/* One messenger for every tab: private Prometheus, support, and rooms. */}
      <ErrorBoundary scope="widget"><Messenger /></ErrorBoundary>
    </BrowserRouter>
  )
}
