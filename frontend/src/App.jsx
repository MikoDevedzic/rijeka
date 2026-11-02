import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import ErrorBoundary    from './components/ErrorBoundary'
import Loading          from './components/common/Loading'
import { hit } from './lib/usage'
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
// first visited (React.lazy): the configuration pages, market data, docs, P&L, risk,
// counterparty credit, and the legacy booking window. Nothing below has an effect
// at import time, so the order modules load in does not matter; the realtime stores
// (trades, chat, market data) are imported by the eager shell above and start where
// they always did. A named export is adapted to the default React.lazy expects.
const named = (load, name) => lazy(() => load().then(m => ({ default: m[name] })))
const PnlPage           = lazy(() => import('./components/pnl/PnlPage'))
const BookingDefaults   = named(() => import('./components/pnl/PnlSettings'), 'BookingDefaults')
const PnlConventions    = named(() => import('./components/pnl/PnlSettings'), 'PnlConventions')
const RiskPage          = lazy(() => import('./components/risk/RiskPage'))
const CcrPage           = lazy(() => import('./components/risk/CcrPage'))
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
const TradeBookingWindow = lazy(() => import('./components/blotter/TradeBookingWindow'))

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


// Renders one window per entry in store — survives navigation.
// Gates between legacy TradeBookingWindow and new unified TradeWindow based
// on the localStorage feature flag 'rijeka.tbw.unified.products' (Sprint 10).
function PersistentBookingWindow() {
  const { windows, close } = useBookingStore()
  if (!windows.length) return null

  // Per-product rollout of the unified TradeWindow. Comma-separated product
  // keys in localStorage 'rijeka.tbw.unified.products' override the default.
  //
  // Default is IR_SWAP: the unified shell is where Sprint 10-13 landed (leg
  // schedules, atomic confirm/cancel, on-chain confirmation) and the legacy
  // window's CONFIRM tab is still a Sprint 6A placeholder. It is IR_SWAP only
  // because booking.js::executeBooking throws for every other product —
  // widening this default would break booking for cap / floor / collar /
  // swaption. Set the key to 'legacy' (or any value without IR_SWAP) to go
  // back; set it to a wider list once atomic booking covers those products.
  const UNIFIED_DEFAULT = 'IR_SWAP'
  const flag = localStorage.getItem('rijeka.tbw.unified.products')
  const unifiedSet = new Set(
    (flag === null ? UNIFIED_DEFAULT : flag)
      .split(',').map(s => s.trim()).filter(Boolean)
  )

  return (
    <>
      {windows.map(w => {
        const productKey = w.productKey || 'IR_SWAP'
        const isNewTrade = !w.trade
        const useUnified = isNewTrade && unifiedSet.has(productKey)

        if (useUnified) {
          return (
            <ErrorBoundary key={w.id} scope="window" onReset={() => close(w.id)}>
            <TradeWindow
              initialProduct={productKey}
              onClose={() => close(w.id)}
              onBook={() => {
                // L25 fix (Apr 24, 2026): no-op stub.
                // The real booking path is booking.js::executeBooking which
                // POSTs to Supabase directly. This callback is retained for
                // prop-signature compatibility with TradeWindow but intentionally
                // does no work. Blotter refresh is handled by useTradesStore
                // and useTabStore in TradeWindow's handleConfirm/handleCancelTrade
                // (commit 529c232).
              }}
            />
            </ErrorBoundary>
          )
        }

        return (
          <ErrorBoundary key={w.id} scope="window" onReset={() => close(w.id)}>
          <Suspense fallback={<Loading label="LOADING WINDOW..." style={{ position: 'fixed', left: w.x, top: w.y, zIndex: 1000 }} />}>
          <TradeBookingWindow
            windowId={w.id}
            initialPos={{ x: w.x, y: w.y }}
            trade={w.trade || null}
            onClose={() => close(w.id)}
          />
          </Suspense>
          </ErrorBoundary>
        )
      })}
    </>
  )
}

// The Users page is for admins; everyone else lands on the configurations home.
function AdminOnly({ children }) {
  const { profile } = useAuthStore()
  if ((profile?.role || 'viewer') !== 'admin') return <Navigate to="/configurations" replace />
  return children
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
            <Route path="/pnl"     element={<PnlPage />} />
            <Route path="/risk"    element={<RiskPage />} />
            <Route path="/risk/ccr" element={<CcrPage />} />
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
              <Route path="market-risk/limits" element={<LimitsPage />} />
              <Route path="market-risk/var"    element={<VarSettingsPage />} />
              <Route path="market-risk/stress" element={<StressCatalogue />} />
              <Route path="legal-entities"     element={<LegalEntities />} />
              <Route path="counterparties"              element={<Counterparties />} />
              <Route path="market-data/swvol"            element={<SwaptionVolDetail />} />
              <Route path="market-data/capfloor"             element={<CapVolDetail />} />
              <Route path="market-data/crypto"               element={<FxWorkspace />} />
              <Route path="xva-parameters/hw1f"          element={<XVAParametersTab />} />
              <Route path="users"              element={<AdminOnly><Users /></AdminOnly>} />
              <Route path="system"             element={<SystemPage />} />
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
