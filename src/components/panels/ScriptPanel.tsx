import { useState } from 'react'
import { runScript, EXAMPLE_SCRIPTS } from '../../scripting/runner'
import { useEditor } from '../../state/store'

export function ScriptPanel() {
  const [code, setCode] = useState(EXAMPLE_SCRIPTS[0].code)
  const [output, setOutput] = useState<{ text: string; kind: 'ok' | 'err' | '' }[]>([])
  const [running, setRunning] = useState(false)
  const setBusy = useEditor((s) => s.setBusy)

  const execute = async () => {
    setRunning(true)
    setBusy('Running script…')
    setOutput([])
    const result = await runScript(code)
    const lines = result.logs.map((l) => ({ text: l, kind: '' as const }))
    if (result.ok) {
      setOutput([...lines, { text: `✓ finished in ${Math.round(result.elapsed)}ms`, kind: 'ok' }])
    } else {
      setOutput([...lines, { text: `✗ ${result.error}`, kind: 'err' }])
    }
    setRunning(false)
    setBusy(null)
  }

  return (
    <>
      <h3>Scripting</h3>
      <p className="hint">
        Automate edits with JavaScript. The <code>editor</code> API can add and
        cut clips, keyframe transforms, and call every local AI tool —
        see <b>docs/SCRIPTING.md</b> for the full reference. Undo (⌘Z) reverts
        script edits.
      </p>
      <label className="field">Examples
        <select
          onChange={(e) => {
            const ex = EXAMPLE_SCRIPTS[Number(e.target.value)]
            if (ex) setCode(ex.code)
          }}>
          {EXAMPLE_SCRIPTS.map((ex, i) => (
            <option key={ex.label} value={i}>{ex.label}</option>
          ))}
        </select>
      </label>
      <div className="script-editor">
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void execute()
            }
          }}
        />
        <button className="primary" onClick={execute} disabled={running}>
          {running ? 'Running…' : 'Run script (⌘⏎)'}
        </button>
        {output.length > 0 && (
          <div className="script-log">
            {output.map((o, i) => (
              <div key={i} className={o.kind}>{o.text}</div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
