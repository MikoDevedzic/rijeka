import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/useAuthStore'
import AuthGuard        from './components/auth/AuthGuard'
import LoginPage        from './components/auth/LoginPage'
import SignupPage       from './components/auth/SignupPage'
import ConfirmPage      from './components/auth/ConfirmPage'
import CommandCenter    from './components/CommandCenter'
import AppBar           from './components/layout/AppBar'
import CfgNav           from './components/layout/CfgNav'
import BlotterShell     from './components/blotter/BlotterShell'
import PricerPage       from './components/pricer/PricerPage'
import CurvesWorkspace  from './components/market-data/CurvesWorkspace'
import OrgHierarchy     from './components/org/OrgHierarchy'
import LegalEntities    from './components/onboarding/LegalEntities'
import Counterparties   from './components/onboarding/Counterparties'
import Users            from './components/admin/Users'
import PrometheusPanel  from './components/PrometheusPanel'
import TradeBookingWindow from './components/blotter/TradeBookingWindow'
import TradeWindow        from './components/trade-window/TradeWindow'
import useBookingStore    from './store/useBookingStore'
import SwaptionVolDetail from './components/market-data/SwaptionVolDetail'
import CapVolDetail      from './components/market-data/CapVolDetail'
import XVAParametersTab  from './components/configurations/XVAParametersTab'

function BlotterLayout() {
  return (
    <div style={{display:'flex',height:'100vh',flexDirection:'column'}}>
      <AppBar />
      <div style={{flex:1,overflow:'hidden'}}><AuthGuard /></div>
      <PrometheusPanel />
    </div>
  )
}

function ConfigLayout() {
  return (
    <div style={{display:'flex',height:'100vh',flexDirection:'column'}}>
      <AppBar />
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        <CfgNav />
        <main style={{flex:1,overflow:'auto',background:'var(--bg)'}}><AuthGuard /></main>
      </div>
      <PrometheusPanel />
    </div>
  )
}


// Renders one window per entry in store — survives navigation.
// Gates between legacy TradeBookingWindow and new unified TradeWindow based
// on the localStorage feature flag 'rijeka.tbw.unified.products' (Sprint 10).
function PersistentBookingWindow() {
  const { windows, close } = useBookingStore()
  if (!windows.length) return null

  // Per-product opt-in. Comma-separated list of product keys.
  // Empty/missing = everyone uses legacy (default, safe rollout).
  const unifiedSet = new Set(
    (localStorage.getItem('rijeka.tbw.unified.products') || '')
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
            <TradeWindow
              key={w.id}
              initialProduct={productKey}
              onClose={() => close(w.id)}
              onBook={(payload) => {
                // Patch 6 will implement the booking path (POST /api/trades/,
                // legs, /price, blotter update). For Phase 2 pricing validation,
                // book via legacy by removing the feature flag entry.
                console.log('[trade-window] BOOK clicked (not yet wired):', payload)
                alert('Booking via the unified shell lands in Patch 6.\n\n' +
                      'To book this trade: open DevTools, run\n' +
                      "  localStorage.removeItem('rijeka.tbw.unified.products')\n" +
                      'refresh, and re-enter via the legacy window.')
              }}
            />
          )
        }

        return (
          <TradeBookingWindow
            key={w.id}
            windowId={w.id}
            initialPos={{ x: w.x, y: w.y }}
            trade={w.trade || null}
            onClose={() => close(w.id)}
          />
        )
      })}
    </>
  )
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
      <Routes>
        <Route path="/login"   element={<LoginPage />} />
        <Route path="/signup"  element={<SignupPage />} />
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route element={<AuthGuard />}>
          <Route path="/command-center" element={<><CommandCenter /><PrometheusPanel /></>} />
          <Route element={<BlotterLayout />}>
            <Route path="/blotter" element={<BlotterShell />} />
            <Route path="/pricer"  element={<PricerPage />} />
          </Route>
          <Route element={<ConfigLayout />}>
            <Route path="/configurations">
              <Route index element={<Navigate to="market-data/curves" replace />} />
              <Route path="market-data/curves" element={<CurvesWorkspace />} />
              <Route path="org-hierarchy"      element={<OrgHierarchy />} />
              <Route path="legal-entities"     element={<LegalEntities />} />
              <Route path="counterparties"              element={<Counterparties />} />
              <Route path="market-data/swvol"            element={<SwaptionVolDetail />} />
              <Route path="market-data/capfloor"             element={<CapVolDetail />} />
              <Route path="xva-parameters/hw1f"          element={<XVAParametersTab />} />
              <Route path="users"              element={<Users />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/command-center" replace />} />
      </Routes>
      <PersistentBookingWindow />
    </BrowserRouter>
  )
}
