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
import CurvesWorkspace  from './components/market-data/CurvesWorkspace'
import OrgHierarchy     from './components/org/OrgHierarchy'
import LegalEntities    from './components/onboarding/LegalEntities'
import Counterparties   from './components/onboarding/Counterparties'
import Users            from './components/admin/Users'

function BlotterLayout() {
  return (
    <div style={{display:'flex',height:'100vh',flexDirection:'column'}}>
      <AppBar />
      <div style={{flex:1,overflow:'hidden'}}><AuthGuard /></div>
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
    </div>
  )
}

export default function App() {
  const { initAuth, loading } = useAuthStore()
  useEffect(() => { initAuth() }, [])
  if (loading) return (
    <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)',color:'var(--accent)',fontFamily:'var(--mono)',fontSize:'0.75rem',letterSpacing:'0.15em'}}>
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
          <Route path="/command-center" element={<CommandCenter />} />
          <Route element={<BlotterLayout />}>
            <Route path="/blotter" element={<BlotterShell />} />
          </Route>
          <Route element={<ConfigLayout />}>
            <Route path="/configurations">
              <Route index element={<Navigate to="market-data/curves" replace />} />
              <Route path="market-data/curves" element={<CurvesWorkspace />} />
              <Route path="org-hierarchy"      element={<OrgHierarchy />} />
              <Route path="legal-entities"     element={<LegalEntities />} />
              <Route path="counterparties"     element={<Counterparties />} />
              <Route path="users"              element={<Users />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/command-center" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
