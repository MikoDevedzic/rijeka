// src/components/org/OrgHierarchy.jsx
// Rijeka — Sprint 2 Day 4 (rev 3)

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const NODE_COLOR = {
  firm: 'var(--accent)', division: 'var(--blue)', desk: 'var(--amber)',
  book: '#3d8bc8', strategy: 'var(--purple)', custom: '#2a3f52',
}
const CHILD_TYPE = {
  firm: 'division', division: 'desk', desk: 'book', book: 'strategy', strategy: null, custom: 'custom',
}
const TYPE_LABEL = {
  firm: 'FIRM', division: 'DIV', desk: 'DESK', book: 'BOOK', strategy: 'STRAT', custom: 'CUST',
}

function buildTree(flat, showInactive) {
  const visible = showInactive ? flat : flat.filter(n => n.is_active)
  const map = {}
  const sorted = [...visible].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  sorted.forEach(n => { map[n.id] = { ...n, children: [] } })
  const roots = []
  sorted.forEach(n => {
    if (n.parent_id && map[n.parent_id]) map[n.parent_id].children.push(map[n.id])
    else roots.push(map[n.id])
  })
  return roots
}

function hasDescendants(flat, nodeId) {
  return flat.some(n => n.parent_id === nodeId)
}

function getAllDescendants(flat, parentId) {
  const direct = flat.filter(n => n.parent_id === parentId).map(n => n.id)
  return direct.flatMap(id => [id, ...getAllDescendants(flat, id)])
}

function Btn({ color, onClick, title, children }) {
  const [hover, setHover] = useState(false)
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? color + '22' : 'none', border: '1px solid ' + color,
        borderRadius: '2px', color, fontFamily: 'var(--mono)', fontSize: '9px',
        padding: '2px 7px', cursor: 'pointer', letterSpacing: '0.06em',
        transition: 'background 0.12s', whiteSpace: 'nowrap',
      }}
    >{children}</button>
  )
}

function NodeRow({ node, depth, collapsed, toggleCollapse, editing, setEditing, onRename, onAdd, onDeactivate, onDelete, allNodes, dragHandle }) {
  const isEditing = editing?.id === node.id
  const inputRef  = useRef(null)
  const color     = NODE_COLOR[node.node_type]
  const hasKids   = (node.children ?? []).length > 0
  const canDelete = !node.is_active && !hasDescendants(allNodes, node.id)

  useEffect(() => { if (isEditing) inputRef.current?.focus() }, [isEditing])

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '7px',
        paddingTop: '5px', paddingBottom: '5px', paddingRight: '10px',
        paddingLeft: (depth * 22 + 10) + 'px',
        borderLeft: '2px solid ' + (node.is_active ? color : 'var(--border)'),
        marginBottom: '2px', background: 'var(--panel)',
        borderRadius: '0 3px 3px 0', fontSize: '12px', minHeight: '30px',
        opacity: node.is_active ? 1 : 0.45, transition: 'background 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--panel-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--panel)'}
    >
      <span {...dragHandle} title="Drag to reorder"
        style={{ cursor: 'grab', color: 'var(--text-dim)', fontSize: '13px', userSelect: 'none', flexShrink: 0, lineHeight: 1 }}>
        ⠿
      </span>
      <button onClick={() => hasKids && toggleCollapse(node.id)}
        style={{ background: 'none', border: 'none', color: hasKids ? 'var(--text-dim)' : 'transparent', cursor: hasKids ? 'pointer' : 'default', fontSize: '8px', padding: 0, width: '12px', flexShrink: 0, lineHeight: 1 }}>
        {hasKids ? (collapsed.has(node.id) ? '▶' : '▼') : ''}
      </button>
      <span style={{ color, fontSize: '9px', fontWeight: '700', letterSpacing: '0.1em', width: '30px', flexShrink: 0 }}>
        {TYPE_LABEL[node.node_type]}
      </span>
      {isEditing ? (
        <input ref={inputRef} value={editing.value}
          onChange={e => setEditing(p => ({ ...p, value: e.target.value }))}
          onBlur={() => editing.value.trim() ? onRename(node.id, editing.value.trim()) : setEditing(null)}
          onKeyDown={e => {
            if (e.key === 'Enter' && editing.value.trim()) onRename(node.id, editing.value.trim())
            if (e.key === 'Escape') setEditing(null)
          }}
          style={{ flex: 1, background: 'var(--panel-3)', border: '1px solid ' + color, borderRadius: '2px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '12px', padding: '2px 6px', outline: 'none' }}
        />
      ) : (
        <span onDoubleClick={() => node.is_active && setEditing({ id: node.id, value: node.name })}
          style={{ flex: 1, userSelect: 'none', cursor: 'default' }}
          title={node.is_active ? 'Double-click to rename' : 'Inactive'}>
          {node.name}
        </span>
      )}
      {!node.is_active && (
        <span style={{ fontSize: '9px', color: 'var(--red)', letterSpacing: '0.08em', flexShrink: 0 }}>INACTIVE</span>
      )}
      {!isEditing && (
        <div style={{ display: 'flex', gap: '5px', flexShrink: 0, marginLeft: 'auto' }}>
          {node.is_active ? (
            <>
              {CHILD_TYPE[node.node_type] && (
                <Btn color={color} onClick={() => onAdd(node.id, CHILD_TYPE[node.node_type])}>
                  {'+ ' + (TYPE_LABEL[CHILD_TYPE[node.node_type]] || CHILD_TYPE[node.node_type].toUpperCase())}
                </Btn>
              )}
              <Btn color="var(--red)" onClick={() => onDeactivate(node.id)} title="Deactivate">✕</Btn>
            </>
          ) : canDelete ? (
            <Btn color="var(--red)" onClick={() => onDelete(node.id)} title="Permanently delete">DELETE</Btn>
          ) : null}
        </div>
      )}
    </div>
  )
}

function SortableNodeRow(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.node.id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}>
      <NodeRow {...props} dragHandle={{ ...attributes, ...listeners }} />
    </div>
  )
}

function AddRow({ nodeType, depth, onConfirm, onCancel }) {
  const [name, setName] = useState('')
  const inputRef = useRef(null)
  const color = NODE_COLOR[nodeType]
  useEffect(() => { inputRef.current?.focus() }, [])
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '7px',
      paddingTop: '5px', paddingBottom: '5px', paddingRight: '10px',
      paddingLeft: (depth * 22 + 10) + 'px',
      borderLeft: '2px dashed ' + color, marginBottom: '2px',
      background: 'var(--panel-3)', borderRadius: '0 3px 3px 0', fontSize: '12px', minHeight: '30px',
    }}>
      <span style={{ width: '13px', flexShrink: 0 }} />
      <span style={{ width: '12px', flexShrink: 0 }} />
      <span style={{ color, fontSize: '9px', fontWeight: '700', letterSpacing: '0.1em', width: '30px', flexShrink: 0 }}>
        {TYPE_LABEL[nodeType]}
      </span>
      <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && name.trim()) onConfirm(name.trim())
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={nodeType.replace('_', '-') + ' name...'}
        style={{ flex: 1, background: 'var(--bg)', border: '1px solid ' + color, borderRadius: '2px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '12px', padding: '2px 6px', outline: 'none' }}
      />
      <div style={{ display: 'flex', gap: '5px', flexShrink: 0, marginLeft: 'auto' }}>
        <Btn color={color} onClick={() => name.trim() && onConfirm(name.trim())}>✓</Btn>
        <Btn color="var(--red)" onClick={onCancel}>✕</Btn>
      </div>
    </div>
  )
}

function TreeLevel({ nodes, depth, collapsed, toggleCollapse, editing, setEditing, onRename, onAdd, onDeactivate, onDelete, onReorder, adding, allNodes }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIdx = nodes.findIndex(n => n.id === active.id)
    const newIdx = nodes.findIndex(n => n.id === over.id)
    if (oldIdx !== -1 && newIdx !== -1) onReorder(nodes, oldIdx, newIdx)
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={nodes.map(n => n.id)} strategy={verticalListSortingStrategy}>
        {nodes.map(node => (
          <div key={node.id}>
            <SortableNodeRow node={node} depth={depth} collapsed={collapsed} toggleCollapse={toggleCollapse}
              editing={editing} setEditing={setEditing} onRename={onRename} onAdd={onAdd}
              onDeactivate={onDeactivate} onDelete={onDelete} allNodes={allNodes} />
            {!collapsed.has(node.id) && (
              <>
                {node.children?.length > 0 && (
                  <TreeLevel nodes={node.children} depth={depth + 1} collapsed={collapsed}
                    toggleCollapse={toggleCollapse} editing={editing} setEditing={setEditing}
                    onRename={onRename} onAdd={onAdd} onDeactivate={onDeactivate} onDelete={onDelete}
                    onReorder={onReorder} adding={adding} allNodes={allNodes} />
                )}
                {adding?.parentId === node.id && (
                  <AddRow nodeType={adding.nodeType} depth={depth + 1} onConfirm={adding.onConfirm} onCancel={adding.onCancel} />
                )}
              </>
            )}
          </div>
        ))}
      </SortableContext>
    </DndContext>
  )
}

export default function OrgHierarchy() {
  const { profile } = useAuthStore()
  const [nodes,        setNodes]        = useState([])
  const [collapsed,    setCollapsed]    = useState(new Set())
  const [editing,      setEditing]      = useState(null)
  const [adding,       setAdding]       = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState(null)
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => { fetchNodes() }, [])

  async function fetchNodes() {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase.from('org_nodes').select('*')
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
    if (err) { setError(err.message); setLoading(false); return }
    setNodes(data ?? []); setLoading(false)
  }

  const tree          = useMemo(() => buildTree(nodes, showInactive), [nodes, showInactive])
  const activeCount   = nodes.filter(n => n.is_active).length
  const inactiveCount = nodes.filter(n => !n.is_active).length

  function toggleCollapse(id) {
    setCollapsed(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function onAdd(parentId, nodeType) {
    setCollapsed(prev => { const s = new Set(prev); s.delete(parentId); return s })
    setEditing(null)
    setAdding({ parentId, nodeType, onConfirm: n => confirmAdd(parentId, nodeType, n), onCancel: () => setAdding(null) })
  }
  async function confirmAdd(parentId, nodeType, name) {
    setSaving(true); setError(null)
    const { data, error: err } = await supabase.from('org_nodes')
      .insert({ parent_id: parentId, name, node_type: nodeType, sort_order: nodes.filter(n => n.parent_id === parentId).length, created_by: profile?.trader_id ?? null, is_active: true })
      .select().single()
    if (err) { setError(err.message); setSaving(false); return }
    setNodes(prev => [...prev, data]); setAdding(null); setSaving(false)
  }
  async function initFirm() {
    setSaving(true); setError(null)
    const { data, error: err } = await supabase.from('org_nodes')
      .insert({ parent_id: null, name: 'My Firm', node_type: 'firm', sort_order: 0, created_by: profile?.trader_id ?? null, is_active: true })
      .select().single()
    if (err) { setError(err.message); setSaving(false); return }
    setNodes([data]); setSaving(false)
    setEditing({ id: data.id, value: data.name })
  }
  async function onRename(id, name) {
    setEditing(null); setSaving(true); setError(null)
    const { error: err } = await supabase.from('org_nodes').update({ name }).eq('id', id)
    if (err) { setError(err.message); setSaving(false); return }
    setNodes(prev => prev.map(n => n.id === id ? { ...n, name } : n)); setSaving(false)
  }
  async function onDeactivate(id) {
    setSaving(true); setError(null)
    const { error: err } = await supabase.from('org_nodes').update({ is_active: false }).eq('id', id)
    if (err) { setError(err.message); setSaving(false); return }
    const desc = getAllDescendants(nodes, id)
    if (desc.length > 0) await supabase.from('org_nodes').update({ is_active: false }).in('id', desc)
    setNodes(prev => prev.map(n => n.id === id || desc.includes(n.id) ? { ...n, is_active: false } : n))
    setSaving(false)
  }
  async function onDelete(id) {
    if (!window.confirm('Permanently delete this node? Cannot be undone.')) return
    setSaving(true); setError(null)
    const { error: err } = await supabase.from('org_nodes').delete().eq('id', id)
    if (err) { setError(err.message); setSaving(false); return }
    setNodes(prev => prev.filter(n => n.id !== id)); setSaving(false)
  }
  async function onReorder(siblings, oldIdx, newIdx) {
    const reordered = arrayMove(siblings, oldIdx, newIdx)
    setNodes(prev => {
      const next = [...prev]
      reordered.forEach((node, i) => { const idx = next.findIndex(n => n.id === node.id); if (idx !== -1) next[idx] = { ...next[idx], sort_order: i } })
      return next
    })
    await Promise.all(reordered.map((node, i) => supabase.from('org_nodes').update({ sort_order: i }).eq('id', node.id)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0, background: 'var(--bg)', fontFamily: 'var(--mono)', color: 'var(--text)' }}>

      {/* Slim control bar — no duplicate header, just status + toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)', flexShrink: 0, minHeight: '28px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
          {activeCount} active nodes{saving && ' · saving...'}
        </span>
        {/* Legend */}
        {Object.entries(TYPE_LABEL).map(([type, label]) => (
          <span key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '1px', background: NODE_COLOR[type], display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>{label}</span>
          </span>
        ))}
        <span style={{ fontSize: '9px', color: 'var(--text-dim)', marginLeft: '4px' }}>· dbl-click to rename</span>
        {inactiveCount > 0 && (
          <button onClick={() => setShowInactive(v => !v)}
            style={{
              marginLeft: 'auto', background: showInactive ? 'rgba(217,80,64,0.12)' : 'none',
              border: '1px solid ' + (showInactive ? 'var(--red)' : 'var(--border)'),
              borderRadius: '2px', color: showInactive ? 'var(--red)' : 'var(--text-dim)',
              fontFamily: 'var(--mono)', fontSize: '9px', padding: '2px 8px', cursor: 'pointer',
              letterSpacing: '0.08em', transition: 'all 0.15s',
            }}>
            {showInactive ? 'HIDE INACTIVE (' + inactiveCount + ')' : 'SHOW INACTIVE (' + inactiveCount + ')'}
          </button>
        )}
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {error && (
          <div style={{ padding: '8px 12px', background: 'rgba(217,80,64,0.12)', border: '1px solid var(--red)', borderRadius: '3px', color: 'var(--red)', fontSize: '11px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
            {error}
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '20px', color: 'var(--text-dim)', fontSize: '11px' }}>loading...</div>
        ) : nodes.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '12px', color: 'var(--text-dim)', fontSize: '12px' }}>
            <span style={{ letterSpacing: '0.08em' }}>NO ORG STRUCTURE DEFINED</span>
            <button onClick={initFirm} disabled={saving}
              style={{ background: 'none', border: '1px solid var(--accent)', borderRadius: '3px', color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: '11px', padding: '8px 20px', cursor: 'pointer', letterSpacing: '0.08em' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(14,201,160,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              {saving ? 'INITIALIZING...' : 'INITIALIZE FIRM NODE'}
            </button>
          </div>
        ) : (
          <TreeLevel nodes={tree} depth={0} collapsed={collapsed} toggleCollapse={toggleCollapse}
            editing={editing} setEditing={setEditing} onRename={onRename} onAdd={onAdd}
            onDeactivate={onDeactivate} onDelete={onDelete} onReorder={onReorder}
            adding={adding} allNodes={nodes} />
        )}
      </div>
    </div>
  )
}
