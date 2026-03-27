import { useTabStore } from '../../store/useTabStore'
import BookTab from './BookTab'
import TradeWorkspace from './TradeWorkspace'
import NewTradeWorkspace from './NewTradeWorkspace'
import CompareWorkspace from './CompareWorkspace'
import './BlotterShell.css'

function TabBar() {
  const { tabs, activeId, setActive, closeTab, openNewTrade } = useTabStore()
  return (
    <div className="tab-bar">
      {tabs.map(tab => (
        <div key={tab.id}
          className={`tab ${activeId===tab.id?'tab-active':''} ${tab.type==='new'?'tab-new':''}`}
          onClick={() => setActive(tab.id)}>
          {tab.dirty && <span className="tab-dirty"/>}
          <span className="tab-label">{tab.label}</span>
          {tab.closeable && (
            <button className="tab-close" onClick={e=>{e.stopPropagation();closeTab(tab.id)}}>✕</button>
          )}
        </div>
      ))}
      <button className="tab-new-btn" onClick={() => openNewTrade()}>＋</button>
    </div>
  )
}

export default function BlotterShell() {
  const { tabs, activeId } = useTabStore()
  const activeTab = tabs.find(t => t.id === activeId)
  return (
    <div className="blotter-shell">
      <TabBar />
      <div className="tab-content">
        {activeTab?.type==='book'    && <BookTab />}
        {activeTab?.type==='trade'   && <TradeWorkspace tab={activeTab} />}
        {activeTab?.type==='new'     && <NewTradeWorkspace tab={activeTab} />}
        {activeTab?.type==='compare' && <CompareWorkspace tab={activeTab} />}
      </div>
    </div>
  )
}
