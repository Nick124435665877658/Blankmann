// Alexa verbinden (0.3.54, Nick 23.11.2026): „Alexa, öffne Blankmann“ → Alexa nennt einen 4-stelligen Code → hier eingeben.
// Danach: „Alexa, sag Blankmann, ich habe drei Eier verbraucht.“ (0.3.61: auch eintragen und Vorrat ansagen) Verbundene Alexa-Konten lassen sich trennen (mit Sicherheitsabfrage).
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Link = { id: string; label: string; created_at: string; last_used_at: string | null }
type Status = { kind: 'idle' | 'busy' | 'ok' | 'error'; text?: string }

const when = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function AlexaPanel({ householdId }: { householdId: string }) {
  const [links, setLinks] = useState<Link[]>([])
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('alexa_links').select('id,label,created_at,last_used_at').eq('household_id', householdId).order('created_at')
    if (!error) setLinks((data ?? []) as Link[])
  }, [householdId])
  useEffect(() => { void load() }, [load])

  const connect = async (event: FormEvent) => {
    event.preventDefault()
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 4) { setStatus({ kind: 'error', text: 'Der Code von Alexa hat 4 Ziffern.' }); return }
    if (!supabase) return
    setStatus({ kind: 'busy' })
    const { error } = await supabase.rpc('alexa_confirm_code', { p_household: householdId, p_code: digits })
    if (error) { setStatus({ kind: 'error', text: error.message }); return }
    setCode('')
    setStatus({ kind: 'ok', text: 'Verbunden! Sag jetzt zum Beispiel: „Alexa, sag Blankmann, ich habe drei Eier verbraucht.“' })
    void load()
  }

  const disconnect = async (link: Link) => {
    if (!supabase || !window.confirm('Sicher, dass du das Element „' + link.label + '“ löschen willst? Alexa kann danach nichts mehr am Vorrat ändern, bis du sie neu verbindest.')) return
    const { error } = await supabase.from('alexa_links').delete().eq('id', link.id)
    if (error) setStatus({ kind: 'error', text: error.message })
    else setStatus({ kind: 'ok', text: 'Alexa getrennt.' })
    void load()
  }

  return <div className="panel settings-panel settings-display alexa-panel">
    <div className="setting-block">
      <span className="eyebrow">SPRACHSTEUERUNG</span>
      <h2>Alexa</h2>
      <small className="muted">Verbrauch per Sprache vom Vorrat abziehen: „Alexa, sag Blankmann, ich habe drei Eier verbraucht.“ Eintragen: „… ich habe sechs Eier gekauft“ oder „… Vorrat erfassen“ – fehlt etwas, fragt Alexa nach. Auch: „… was ist im Kühlschrank?“, „… wie viele Eier habe ich noch?“ und „… rückgängig“. Einkaufsliste: „… setz Milch auf die Einkaufsliste“.</small>
      {links.length > 0 && <div className="alexa-links">{links.map(link => <div className="alexa-link" key={link.id}>
        <div><b>{link.label}</b><small>verbunden am {when(link.created_at)} · {link.last_used_at ? 'zuletzt genutzt ' + when(link.last_used_at) : 'noch nicht genutzt'}</small></div>
        <button type="button" className="button button-light button-small" onClick={() => disconnect(link)}>Trennen</button>
      </div>)}</div>}
      <form className="alexa-connect" onSubmit={connect}>
        <label>{links.length ? 'Weiteres Alexa-Konto verbinden – Code' : 'Code von Alexa'}<input name="alexa_code" inputMode="numeric" autoComplete="one-time-code" maxLength={4} placeholder="z. B. 4711" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
        <button className="button button-dark" disabled={status.kind === 'busy'}>{status.kind === 'busy' ? 'Verbinde …' : 'Verbinden'}</button>
      </form>
      <small className="muted alexa-how">So geht's: Sag „Alexa, öffne Blankmann“. Alexa nennt einen 4-stelligen Code (steht auch in der Alexa-App) – den hier eingeben. Der Code gilt 10 Minuten.</small>
      {status.text && <div className={'alert ' + (status.kind === 'error' ? 'error' : 'success')} role="status">{status.text}</div>}
    </div>
  </div>
}
