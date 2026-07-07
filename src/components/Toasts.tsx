import { useEditor } from '../state/store'

export function Toasts() {
  const toasts = useEditor((s) => s.toasts)
  const dismiss = useEditor((s) => s.dismissToast)
  if (!toasts.length) return null
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === 'ok' ? '✓ ' : t.kind === 'error' ? '✕ ' : ''}
          {t.msg}
        </div>
      ))}
    </div>
  )
}
