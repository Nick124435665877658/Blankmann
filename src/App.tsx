import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Apple, BookOpen, CalendarDays, Camera, Check, ChevronDown, CircleDollarSign, ReceiptText, Upload,
  CookingPot, Leaf, ListChecks, LogOut, Plus, Search, Settings2, ShoppingBasket,
  Sparkles, Sprout, Store, Warehouse, X, Smartphone, Tablet,
} from 'lucide-react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type Tab = 'overview' | 'planner' | 'shopping' | 'pantry' | 'recipes' | 'prices' | 'receipts' | 'settings'
type Household = { id: string; name: string }
type Settings = {
  weekly_budget: number
  histamine_low_enabled: boolean
  tomato_free_enabled: boolean
  cream_free_enabled: boolean
  vegetable_rich_enabled: boolean
  dietary_notes: string | null
}
type ShoppingItem = { id: string; name: string; quantity: number | null; unit: string | null; aisle: string | null; checked: boolean; estimated_price: number | null; actual_price: number | null }
type PantryItem = { id: string; name: string; quantity: number | null; unit: string | null; best_before: string | null; storage_location: string | null }
type Meal = { id: string; meal_date: string; meal_type: string; custom_title: string | null; servings: number }
type Recipe = { id: string; title: string; description: string | null; servings: number; prep_minutes: number | null; cook_minutes: number | null; notes: string | null }

type ReceiptUpload = { id: string; image_path: string; retailer_code: string | null; purchase_date: string | null; status: string; created_at: string }

const nav: { id: Tab; label: string; icon: typeof CalendarDays }[] = [
  { id: 'overview', label: 'Übersicht', icon: Sprout },
  { id: 'planner', label: 'Wochenplan', icon: CalendarDays },
  { id: 'shopping', label: 'Einkaufsliste', icon: ShoppingBasket },
  { id: 'pantry', label: 'Vorrat', icon: Warehouse },
  { id: 'recipes', label: 'Rezepte', icon: BookOpen },
  { id: 'prices', label: 'Preise', icon: Store },
  { id: 'receipts', label: 'Bon scannen', icon: ReceiptText },
]

const euro = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n)
const todayISO = () => new Date().toISOString().slice(0, 10)
const mondayISO = (date = new Date()) => {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}
const weekDates = (start: string) => Array.from({ length: 7 }, (_, i) => {
  const d = new Date(start + 'T12:00:00')
  d.setDate(d.getDate() + i)
  return d
})
const shortDate = (d: Date) => new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit' }).format(d)
const friendlyError = (error: unknown) => error instanceof Error ? error.message : 'Das hat gerade nicht geklappt.'
const mealLabel = (type: string) => (({ breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen' } as Record<string, string>)[type] ?? type)
const mealTypeValue = (label: string) => (({ Frühstück: 'breakfast', Mittagessen: 'lunch', Abendessen: 'dinner' } as Record<string, string>)[label] ?? 'dinner')

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [household, setHousehold] = useState<Household | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shopping, setShopping] = useState<ShoppingItem[]>([])
  const [pantry, setPantry] = useState<PantryItem[]>([])
  const [meals, setMeals] = useState<Meal[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [receipts, setReceipts] = useState<ReceiptUpload[]>([])
  const [weekStart, setWeekStart] = useState(mondayISO())
  const [listId, setListId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [receiptBusy, setReceiptBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [visualTheme, setVisualTheme] = useState<'nick' | 'sophia'>(() => {
    try { return localStorage.getItem('blankmann-visual-theme') === 'sophia' ? 'sophia' : 'nick' } catch { return 'nick' }
  })
  const [deviceMode, setDeviceMode] = useState<'auto' | 'phone' | 'tablet'>(() => {
    try {
      const saved = localStorage.getItem('blankmann-device-mode')
      return saved === 'phone' || saved === 'tablet' ? saved : 'auto'
    } catch { return 'auto' }
  })

  useEffect(() => {
    try { localStorage.setItem('blankmann-device-mode', deviceMode) } catch { /* storage unavailable */ }
  }, [deviceMode])

  useEffect(() => {
    try { localStorage.setItem('blankmann-visual-theme', visualTheme) } catch { /* storage unavailable */ }
  }, [visualTheme])

  const refreshHousehold = useCallback(async (user: User) => {
    if (!supabase) return
    const { data: member, error: memberError } = await supabase.from('household_members')
      .select('household_id, households(id,name)').eq('user_id', user.id).limit(1).maybeSingle()
    if (memberError) throw memberError
    const h = (member as any)?.households
    if (!h) { setHousehold(null); return }
    const active = Array.isArray(h) ? h[0] : h
    setHousehold({ id: active.id, name: active.name })
    const { data: prefs, error: prefsError } = await supabase.from('household_settings').select('*').eq('household_id', active.id).maybeSingle()
    if (prefsError) throw prefsError
    setSettings(prefs as Settings | null)
  }, [])

  const refreshData = useCallback(async () => {
    if (!supabase || !household) return
    const { data: lists, error: listError } = await supabase.from('shopping_lists').select('id')
      .eq('household_id', household.id).eq('status', 'open').order('created_at', { ascending: false }).limit(1)
    if (listError) throw listError
    let activeList = lists?.[0]
    if (!activeList) {
      const created = await supabase.from('shopping_lists').insert({ household_id: household.id, title: 'Wocheneinkauf', status: 'open' }).select('id').single()
      if (created.error) throw created.error
      activeList = created.data
    }
    setListId(activeList.id)
    const [shop, stock, plan, recipeRows] = await Promise.all([
      supabase.from('shopping_list_items').select('*').eq('shopping_list_id', activeList.id).order('created_at'),
      supabase.from('pantry_items').select('*').eq('household_id', household.id).order('best_before', { ascending: true, nullsFirst: false }),
      supabase.from('weekly_plans').select('id').eq('household_id', household.id).eq('week_start', weekStart).maybeSingle(),
      supabase.from('recipes').select('id,title,description,servings,prep_minutes,cook_minutes,notes').eq('household_id', household.id).order('created_at', { ascending: false }),
    ])
    if (shop.error) throw shop.error
    if (stock.error) throw stock.error
    if (plan.error) throw plan.error
    if (recipeRows.error) throw recipeRows.error
    setRecipes((recipeRows.data ?? []) as Recipe[])
    const receiptRows = await supabase.from('receipt_uploads').select('id,image_path,retailer_code,purchase_date,status,created_at').eq('household_id', household.id).order('created_at', { ascending: false })
    if (receiptRows.error) throw receiptRows.error
    setReceipts((receiptRows.data ?? []) as ReceiptUpload[])
    setShopping((shop.data ?? []) as ShoppingItem[])
    setPantry((stock.data ?? []) as PantryItem[])
    if (plan.data) {
      const entries = await supabase.from('meal_plan_entries').select('*').eq('weekly_plan_id', plan.data.id).order('meal_date')
      if (entries.error) throw entries.error
      setMeals((entries.data ?? []) as Meal[])
    } else setMeals([])
  }, [household, weekStart])

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) { setHousehold(null); setSettings(null) }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session?.user) refreshHousehold(session.user).catch(e => setError(friendlyError(e)))
  }, [session, refreshHousehold])

  useEffect(() => {
    if (household) refreshData().catch(e => setError(friendlyError(e)))
  }, [household, refreshData])

  useEffect(() => {
    const client = supabase
    if (!client || !household) return
    const channel = client.channel('blankmann-household-' + household.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_list_items', filter: 'household_id=eq.' + household.id }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pantry_items', filter: 'household_id=eq.' + household.id }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_plan_entries', filter: 'household_id=eq.' + household.id }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes', filter: 'household_id=eq.' + household.id }, () => refreshData())
      .subscribe()
    return () => { client.removeChannel(channel) }
  }, [household, refreshData])

  const remaining = useMemo(() => shopping.filter(i => !i.checked).length, [shopping])
  const spent = useMemo(() => shopping.reduce((sum, i) => sum + Number(i.actual_price ?? 0), 0), [shopping])
  const budget = Number(settings?.weekly_budget ?? 100)

  async function signOut() { await supabase?.auth.signOut() }

  async function uploadReceipt(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !household || !session?.user) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const file = form.get('receipt') as File | null
    if (!file || !file.size) { setError('Bitte fotografiere oder wähle zuerst einen Kassenbon aus.'); return }
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { setError('Bitte nutze ein Foto im JPG-, PNG- oder WebP-Format.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Das Foto darf maximal 10 MB groß sein.'); return }
    setReceiptBusy(true); setError(''); setNotice('')
    const path = household.id + '/' + crypto.randomUUID() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const uploaded = await supabase.storage.from('receipt-photos').upload(path, file, { contentType: file.type, upsert: false })
    if (uploaded.error) { setReceiptBusy(false); setError(uploaded.error.message); return }
    const inserted = await supabase.from('receipt_uploads').insert({ household_id: household.id, image_path: path, retailer_code: String(form.get('retailer') || '') || null, purchase_date: String(form.get('purchase_date') || '') || null, created_by: session.user.id })
    setReceiptBusy(false)
    if (inserted.error) { await supabase.storage.from('receipt-photos').remove([path]); setError(inserted.error.message); return }
    formElement.reset(); setNotice('Bon sicher hochgeladen. Er wartet jetzt auf die Preiserfassung.'); await refreshData()
  }

  if (!isSupabaseConfigured || !supabase) return <SetupScreen />
  if (!authReady) return <div className="loading-screen"><div className="brand-mark">B.</div><p>BLANKMANN wird vorbereitet …</p></div>
  if (!session) return <AuthScreen />
  if (!household) return <HouseholdSetup user={session.user} onCreated={async () => refreshHousehold(session.user)} />

  async function addShoppingItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !household || !listId) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const name = String(form.get('name') ?? '').trim()
    if (!name) return
    setBusy(true); setError('')
    const result = await supabase.from('shopping_list_items').insert({
      household_id: household.id, shopping_list_id: listId, name, quantity: form.get('quantity') ? Number(form.get('quantity')) : null,
      unit: String(form.get('unit') || '') || null, aisle: String(form.get('aisle') || 'Sonstiges'), checked: false,
    })
    setBusy(false)
    if (result.error) { setError(result.error.message); return }
    formElement.reset(); await refreshData()
  }

  async function toggleShopping(item: ShoppingItem) {
    if (!supabase) return
    const { error: updateError } = await supabase.from('shopping_list_items').update({ checked: !item.checked }).eq('id', item.id)
    if (updateError) setError(updateError.message); else await refreshData()
  }

  async function saveActualPrice(item: ShoppingItem, rawValue: string) {
    if (!supabase) return
    const actual = rawValue.trim() === '' ? null : Number(rawValue)
    if (actual !== null && (!Number.isFinite(actual) || actual < 0)) return
    const { error: updateError } = await supabase.from('shopping_list_items').update({ actual_price: actual }).eq('id', item.id)
    if (updateError) setError(updateError.message); else await refreshData()
  }

  async function addPantryItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !household) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const name = String(form.get('name') ?? '').trim()
    if (!name) return
    const { error: insertError } = await supabase.from('pantry_items').insert({
      household_id: household.id, name, quantity: form.get('quantity') ? Number(form.get('quantity')) : null,
      unit: String(form.get('unit') || '') || null, best_before: String(form.get('best_before') || '') || null,
      storage_location: String(form.get('storage_location') || 'Vorratsschrank'),
    })
    if (insertError) setError(insertError.message); else { formElement.reset(); await refreshData() }
  }

  async function addMeal(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const currentUser = session?.user
    if (!supabase || !household || !currentUser) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const title = String(form.get('title') ?? '').trim()
    if (!title) return
    setBusy(true); setError('')
    let plan = await supabase.from('weekly_plans').select('id').eq('household_id', household.id).eq('week_start', weekStart).maybeSingle()
    if (plan.error) { setBusy(false); setError(plan.error.message); return }
    if (!plan.data) {
      const created = await supabase.from('weekly_plans').insert({ household_id: household.id, week_start: weekStart, budget, created_by: currentUser.id }).select('id').single()
      if (created.error) { setBusy(false); setError(created.error.message); return }
      plan = { data: created.data, error: null } as typeof plan
    }
    const { error: mealError } = await supabase.from('meal_plan_entries').insert({
      household_id: household.id, weekly_plan_id: plan.data!.id, meal_date: String(form.get('meal_date')),
      meal_type: mealTypeValue(String(form.get('meal_type'))), custom_title: title, servings: 2,
    })
    setBusy(false)
    if (mealError) setError(mealError.message); else { formElement.reset(); await refreshData() }
  }

  async function addRecipe(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const currentUser = session?.user
    if (!supabase || !household || !currentUser) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const title = String(form.get('title') ?? '').trim()
    if (!title) return
    setBusy(true); setError('')
    const created = await supabase.from('recipes').insert({
      household_id: household.id, title, description: String(form.get('description') || '') || null,
      source_type: 'manual', servings: Number(form.get('servings') || 2),
      prep_minutes: form.get('prep_minutes') ? Number(form.get('prep_minutes')) : null,
      cook_minutes: form.get('cook_minutes') ? Number(form.get('cook_minutes')) : null,
      instructions: [], notes: null, created_by: currentUser.id,
    }).select('id').single()
    if (created.error) { setBusy(false); setError(created.error.message); return }
    const ingredients = String(form.get('ingredients') || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    if (ingredients.length) {
      const rows = ingredients.map(name => ({
        household_id: household.id, recipe_id: created.data.id, name, normalized_name: name.toLocaleLowerCase('de-DE'),
        quantity: null, unit: null, aisle: 'Sonstiges', is_optional: false, source_text: name,
      }))
      const inserted = await supabase.from('recipe_ingredients').insert(rows)
      if (inserted.error) { setBusy(false); setError('Rezept gespeichert, Zutaten konnten nicht gespeichert werden: ' + inserted.error.message); await refreshData(); return }
    }
    setBusy(false); formElement.reset(); await refreshData()
  }

  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !household) return
    const form = new FormData(e.currentTarget)
    const next = {
      household_id: household.id, weekly_budget: Number(form.get('weekly_budget') || 100),
      histamine_low_enabled: form.get('histamine_low_enabled') === 'on',
      tomato_free_enabled: form.get('tomato_free_enabled') === 'on',
      cream_free_enabled: form.get('cream_free_enabled') === 'on',
      vegetable_rich_enabled: form.get('vegetable_rich_enabled') === 'on',
      dietary_notes: String(form.get('dietary_notes') || '') || null,
    }
    const { error: saveError } = await supabase.from('household_settings').upsert(next, { onConflict: 'household_id' })
    if (saveError) setError(saveError.message); else { setSettings(next); setNotice('Einstellungen gespeichert.') }
  }

  const days = weekDates(weekStart)
  const groupedShopping = shopping.reduce<Record<string, ShoppingItem[]>>((acc, item) => {
    const group = item.aisle || 'Sonstiges'; (acc[group] ??= []).push(item); return acc
  }, {})

  return <div className={"app-shell theme-" + visualTheme + (deviceMode === "tablet" ? " device-tablet" : deviceMode === "phone" ? " device-phone" : "")}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">B.</div><div><strong>BLANKMANN</strong><span>FOODPLANNER</span></div></div>
      <div className="household-chip"><span className="online-dot" />{household.name}<ChevronDown size={14} /></div>
      <nav>{nav.map(item => <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { setTab(item.id); setError(''); setNotice('') }}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.id === 'shopping' && remaining > 0 && <small>{remaining}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="budget-mini"><div className="budget-mini-top"><span>Wochenbudget</span><strong>{euro(budget)}</strong></div><div className="progress"><i style={{ width: Math.min(100, spent / Math.max(1, budget) * 100) + '%' }} /></div><small>{euro(spent)} erfasst</small></div><button className="profile-button" onClick={signOut}><div className="avatar">{(session.user.email?.[0] ?? 'B').toUpperCase()}</div><span><b>Mein Konto</b><small>Abmelden</small></span><LogOut size={16} /></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="topbar-left"><div className="build-meta"><b>BUILD 17.11.26-C</b><span>VERSION 0.2.1</span></div><div className="breadcrumb">Dein Zuhause <span>/</span> {nav.find(n => n.id === tab)?.label}</div></div><div className="mobile-brand"><div className="brand-mark">B.</div><strong>BLANKMANN</strong></div><div className="topbar-right"><span className="sync-status"><i /> Gemeinsam synchronisiert</span><div className="theme-switch" role="group" aria-label="Design wählen"><button type="button" className={visualTheme === 'nick' ? 'theme-choice selected' : 'theme-choice'} onClick={() => setVisualTheme('nick')}>Nick</button><button type="button" className={visualTheme === 'sophia' ? 'theme-choice selected' : 'theme-choice'} onClick={() => setVisualTheme('sophia')}>Sophia</button></div><div className="device-switch" role="group" aria-label="Ansicht wählen"><button type="button" className={deviceMode === 'phone' ? 'device-choice selected' : 'device-choice'} aria-label="Handy-Ansicht" title="Handy-Ansicht" onClick={() => setDeviceMode('phone')}><Smartphone size={16}/><span>Handy</span></button><button type="button" className={deviceMode === 'tablet' ? 'device-choice selected' : 'device-choice'} aria-label="Tablet-Ansicht" title="Tablet-Ansicht" onClick={() => setDeviceMode('tablet')}><Tablet size={16}/><span>Tablet</span></button><button type="button" className={deviceMode === 'auto' ? 'device-choice selected auto-choice' : 'device-choice auto-choice'} aria-label="Automatische Ansicht" title="Automatisch" onClick={() => setDeviceMode('auto')}>Auto</button></div><button className="icon-button" aria-label="Einstellungen" onClick={() => setTab('settings')}><Settings2 size={19} /></button></div></header>
      <div className="page-wrap">
        {error && <div className="alert error"><span>{error}</span><button onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && <div className="alert success"><Check size={16}/>{notice}</div>}
        {tab === 'overview' && <section>
          <div className="page-heading"><div><div className="eyebrow">DIENSTAG · DEIN WOCHENSTART</div><h1>Was gibt’s diese Woche?</h1><p>Gemeinsam planen, entspannt einkaufen und nichts verschwenden.</p></div><div className="heading-icon"><Sprout size={25}/></div></div>
          <div className="stat-grid">
            <Stat icon={CircleDollarSign} label="Wochenbudget" value={euro(budget)} sub={euro(Math.max(0,budget-spent))+' noch übrig'} />
            <Stat icon={ShoppingBasket} label="Noch einzukaufen" value={String(remaining)} sub="Artikel auf deiner Liste" />
            <Stat icon={Warehouse} label="Im Vorrat" value={String(pantry.length)} sub="gespeicherte Zutaten" />
            <Stat icon={CookingPot} label="Geplante Mahlzeiten" value={String(meals.length)} sub="für diese Woche" />
          </div>
          <div className="content-grid">
            <div className="panel week-panel"><div className="panel-head"><div><span className="eyebrow">DEIN SPEISEPLAN</span><h2>Diese Woche</h2></div><button className="text-link" onClick={() => setTab('planner')}>Plan öffnen <span>→</span></button></div>
              <div className="week-strip">{days.map(d => <button key={d.toISOString()} onClick={() => setTab('planner')} className={d.toISOString().slice(0,10) === todayISO() ? 'day-pill today' : 'day-pill'}><b>{shortDate(d).split(',')[0]}</b><span>{d.getDate()}</span></button>)}</div>
              {meals.length ? <div className="meal-preview">{meals.slice(0,4).map(m => <div className="meal-row" key={m.id}><span className="meal-dot"/><div><b>{m.custom_title || 'Mahlzeit'}</b><small>{new Date(m.meal_date+'T12:00:00').toLocaleDateString('de-DE',{weekday:'long'})} · {mealLabel(m.meal_type)}</small></div></div>)}</div> : <div className="empty-state compact"><div className="empty-illustration"><CookingPot size={24}/></div><b>Der Plan ist noch leer.</b><span>Füge eure ersten Gerichte hinzu.</span><button className="button button-dark button-small" onClick={() => setTab('planner')}>Woche planen <span>→</span></button></div>}
            </div>
            <div className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">GUT VORBEREITET</span><h2>Einkauf im Blick</h2></div><button className="round-icon" onClick={() => setTab('shopping')}><ListChecks size={18}/></button></div>
              {shopping.length ? <><div className="shopping-progress"><div className="progress"><i style={{width:(shopping.filter(i=>i.checked).length/ shopping.length*100)+'%'}}/></div><small>{shopping.filter(i=>i.checked).length} von {shopping.length} erledigt</small></div>{shopping.filter(i=>!i.checked).slice(0,5).map(i=><div className="mini-item" key={i.id}><button className="check-circle" onClick={()=>toggleShopping(i)} aria-label="Abhaken"/><span>{i.name}</span>{i.quantity && <small>{i.quantity} {i.unit}</small>}</div>)}<button className="button button-light button-full" onClick={()=>setTab('shopping')}>Zur Einkaufsliste</button></> : <div className="empty-state compact"><div className="empty-illustration"><ShoppingBasket size={24}/></div><b>Alles auf Anfang.</b><span>Deine Einkaufsliste wartet auf dich.</span><button className="button button-dark button-small" onClick={()=>setTab('shopping')}>Artikel hinzufügen</button></div>}
            </div>
          </div>
          <div className="tip-banner"><div className="tip-icon"><Sparkles size={20}/></div><div><b>Weniger wegwerfen, mehr rausholen.</b><span>Behalte Mindesthaltbarkeitsdaten im Blick und plane Zutaten mehrfach ein.</span></div><button onClick={()=>setTab('pantry')}>Vorrat ansehen →</button></div>
        </section>}
        {tab === 'planner' && <section><div className="page-heading"><div><div className="eyebrow">GEMEINSAM KOCHEN</div><h1>Wochenplan</h1><p>Ein guter Plan macht den Einkauf leichter.</p></div></div><div className="week-controls"><button className="button button-light" onClick={()=>setWeekStart(mondayISO(new Date(new Date(weekStart+'T12:00:00').getTime()-7*86400000)))}>← Vorherige Woche</button><b>{new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'long'}).format(new Date(weekStart+'T12:00:00'))} – {new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'long',year:'numeric'}).format(days[6])}</b><button className="button button-light" onClick={()=>setWeekStart(mondayISO(new Date(new Date(weekStart+'T12:00:00').getTime()+7*86400000)))}>Nächste Woche →</button></div><div className="planner-grid">{days.map(d=><div className="planner-day" key={d.toISOString()}><div className="planner-day-head"><b>{shortDate(d)}</b><small>{d.getDate()}.{d.getMonth()+1}.</small></div>{(['Frühstück','Mittagessen','Abendessen'] as const).map(type=><div className="meal-slot" key={type}><small>{type}</small>{meals.filter(m=>m.meal_date===d.toISOString().slice(0,10)&&m.meal_type===mealTypeValue(type)).map(m=><div className="planned-meal" key={m.id}>{m.custom_title}</div>)}</div>)}</div>)}</div><form className="panel form-panel" onSubmit={addMeal}><div className="panel-head"><div><span className="eyebrow">NEUES GERICHT</span><h2>Mahlzeit eintragen</h2></div><CookingPot size={22}/></div><div className="form-row"><label>Gericht<input name="title" placeholder="z. B. Hähnchen mit Ofengemüse" required/></label><label>Tag<input name="meal_date" type="date" defaultValue={weekStart} min={weekStart} max={days[6].toISOString().slice(0,10)} required/></label><label>Mahlzeit<select name="meal_type"><option value="dinner">Abendessen</option><option value="lunch">Mittagessen</option><option value="breakfast">Frühstück</option></select></label><button className="button button-dark" disabled={busy}><Plus size={16}/> Hinzufügen</button></div></form></section>}
        {tab === 'shopping' && <section><div className="page-heading"><div><div className="eyebrow">ZUSAMMEN EINKAUFEN</div><h1>Einkaufsliste</h1><p>Abhaken synchronisiert sich direkt zwischen euren Geräten.</p></div><div className="heading-icon"><ShoppingBasket size={25}/></div></div><div className="shopping-layout"><div className="panel add-panel"><span className="eyebrow">AUF DIE LISTE</span><h2>Was fehlt noch?</h2><form onSubmit={addShoppingItem} className="stack-form"><label>Artikel<input name="name" placeholder="z. B. Paprika" required/></label><div className="form-row"><label>Menge<input name="quantity" type="number" min="0" step="0.1" placeholder="2"/></label><label>Einheit<input name="unit" placeholder="Stück"/></label></div><label>Kategorie<select name="aisle"><option>Obst & Gemüse</option><option>Fleisch & Fisch</option><option>Molkerei</option><option>Trockenware</option><option>Tiefkühl</option><option>Haushalt</option><option>Sonstiges</option></select></label><button className="button button-dark button-full"><Plus size={16}/> Artikel hinzufügen</button></form></div><div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">WOCHENEINKAUF</span><h2>{remaining} offen <span className="muted">/ {shopping.length}</span></h2></div><span className="list-counter">{shopping.length ? Math.round((shopping.length-remaining)/shopping.length*100) : 0}%</span></div>{shopping.length ? Object.entries(groupedShopping).map(([group,items])=><div className="shopping-group" key={group}><h3>{group}</h3>{items.map(item=><div className={item.checked?'shopping-item checked':'shopping-item'} key={item.id}><button className="check-circle" onClick={()=>toggleShopping(item)}>{item.checked&&<Check size={13}/>}</button><span>{item.name}</span>{item.quantity && <small>{item.quantity} {item.unit}</small>}<input className="price-input" aria-label={item.name+' tatsächlicher Preis'} type="number" min="0" step="0.01" placeholder="€" defaultValue={item.actual_price??''} onBlur={e=>saveActualPrice(item,e.target.value)}/></div>)}</div>) : <div className="empty-state"><ShoppingBasket size={30}/><b>Deine Liste ist noch leer.</b><span>Füge links den ersten Artikel hinzu.</span></div>}</div></div></section>}
        {tab === 'pantry' && <section><div className="page-heading"><div><div className="eyebrow">WENIGER VERSCHWENDEN</div><h1>Dein Vorrat</h1><p>Was da ist, muss nicht noch einmal gekauft werden.</p></div><div className="heading-icon"><Warehouse size={25}/></div></div><div className="shopping-layout"><div className="panel add-panel"><span className="eyebrow">VORRAT ERGÄNZEN</span><h2>Was habt ihr da?</h2><form className="stack-form" onSubmit={addPantryItem}><label>Zutat<input name="name" placeholder="z. B. Kartoffeln" required/></label><div className="form-row"><label>Menge<input name="quantity" type="number" min="0" step="0.1" placeholder="1"/></label><label>Einheit<input name="unit" placeholder="kg"/></label></div><label>Mindesthaltbar bis<input name="best_before" type="date"/></label><label>Lagerort<select name="storage_location"><option>Vorratsschrank</option><option>Kühlschrank</option><option>Gefrierfach</option><option>Keller</option></select></label><button className="button button-dark button-full"><Plus size={16}/> Zum Vorrat</button></form></div><div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">EURE ZUTATEN</span><h2>{pantry.length} Vorratsartikel</h2></div><Search size={19}/></div>{pantry.length?pantry.map(item=><div className="pantry-row" key={item.id}><div className="pantry-icon"><Apple size={18}/></div><div className="pantry-name"><b>{item.name}</b><small>{item.storage_location || 'Vorrat'} {item.best_before?'· MHD '+new Date(item.best_before+'T12:00:00').toLocaleDateString('de-DE'):''}</small></div><span>{item.quantity??''} {item.unit??''}</span></div>):<div className="empty-state"><Warehouse size={30}/><b>Noch ist der Vorrat leer.</b><span>Trage eure Zutaten ein, damit wir sie beim Planen berücksichtigen können.</span></div>}</div></div></section>}
        {tab === 'recipes' && <section><div className="page-heading"><div><div className="eyebrow">EURE REZEPTSAMMLUNG</div><h1>Rezepte</h1><p>Lieblingsgerichte sammeln – Cookidoo-Import kommt als nächster Schritt.</p></div><div className="heading-icon"><BookOpen size={25}/></div></div><div className="shopping-layout"><form className="panel add-panel stack-form" onSubmit={addRecipe}><span className="eyebrow">NEUES REZEPT</span><h2>Gericht speichern</h2><label>Name<input name="title" placeholder="z. B. Hähnchen-Gemüse-Pfanne" required/></label><label>Kurzbeschreibung<input name="description" placeholder="Was macht das Gericht besonders?"/></label><div className="form-row"><label>Portionen<input name="servings" type="number" min="1" defaultValue="2"/></label><label>Vorbereitung (Min.)<input name="prep_minutes" type="number" min="0" placeholder="15"/></label></div><label>Kochzeit (Min.)<input name="cook_minutes" type="number" min="0" placeholder="25"/></label><label>Zutaten – eine pro Zeile<textarea name="ingredients" placeholder={'2 Hähnchenbrustfilets\\n1 Zucchini\\n1 rote Paprika'} rows={5}/></label><button className="button button-dark button-full" disabled={busy}><Plus size={16}/> Rezept speichern</button></form><div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">EURE SAMMLUNG</span><h2>{recipes.length} Rezepte</h2></div><BookOpen size={19}/></div>{recipes.length?recipes.map(recipe=><div className="recipe-row" key={recipe.id}><div className="pantry-icon"><CookingPot size={18}/></div><div className="pantry-name"><b>{recipe.title}</b><small>{recipe.description || 'Eigenes Rezept'} · {recipe.servings} Portionen</small></div><span>{[recipe.prep_minutes,recipe.cook_minutes].filter(Boolean).length?[recipe.prep_minutes,recipe.cook_minutes].filter(Boolean).reduce((a,b)=>Number(a)+Number(b),0)+' Min.':'–'}</span></div>):<div className="empty-state"><BookOpen size={30}/><b>Noch keine Rezepte gespeichert.</b><span>Füge links euer erstes Lieblingsgericht hinzu.</span></div>}</div></div><div className="preference-chips">{settings?.histamine_low_enabled&&<span><Leaf size={14}/> Histaminbewusst</span>}{settings?.tomato_free_enabled&&<span>Tomatenfrei</span>}{settings?.cream_free_enabled&&<span>Sahnefrei</span>}{settings?.vegetable_rich_enabled&&<span>Gemüsereich</span>}</div><div className="notice-card"><Sparkles size={18}/><span>Cookidoo-Rezepte können wir im nächsten Ausbauschritt über einen Link oder durch manuelle Übernahme ergänzen.</span></div></section>}
        {tab === 'receipts' && <section><div className="page-heading"><div><div className="eyebrow">PREISDATENBANK FÜTTERN</div><h1>Kassenbon erfassen</h1><p>Fotografiere deinen Bon direkt hier. Die Aufnahme wird eurem Haushalt zugeordnet.</p></div><div className="heading-icon"><ReceiptText size={25}/></div></div><div className="shopping-layout"><form className="panel add-panel stack-form" onSubmit={uploadReceipt}><span className="eyebrow">NEUER KASSENBON</span><h2>Bon fotografieren</h2><label>Supermarkt<select name="retailer"><option value="aldi_nord">ALDI Nord</option><option value="lidl">Lidl</option><option value="rewe">REWE</option><option value="kaufland">Kaufland</option><option value="edeka">EDEKA</option><option value="other">Anderer Markt</option></select></label><label>Einkaufsdatum<input name="purchase_date" type="date" defaultValue={todayISO()}/></label><label className="receipt-file-label"><Camera size={19}/> Foto aufnehmen oder auswählen<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required/></label><small>JPG, PNG oder WebP · maximal 10 MB. Das Foto bleibt privat in eurem Haushalt.</small><button className="button button-dark button-full" disabled={receiptBusy}>{receiptBusy?'Bon wird hochgeladen …':<><Upload size={16}/> Bon hochladen</>}</button></form><div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">EURE BELEGE</span><h2>{receipts.length} hochgeladen</h2></div><ReceiptText size={19}/></div>{receipts.length ? receipts.map(r=><div className="pantry-row" key={r.id}><div className="pantry-icon"><ReceiptText size={18}/></div><div className="pantry-name"><b>{{aldi_nord:'ALDI Nord',lidl:'Lidl',rewe:'REWE',kaufland:'Kaufland',edeka:'EDEKA',other:'Anderer Markt'}[r.retailer_code || ''] || 'Supermarkt'}</b><small>{r.purchase_date ? new Date(r.purchase_date+'T12:00:00').toLocaleDateString('de-DE') : new Date(r.created_at).toLocaleDateString('de-DE')} · {r.status==='uploaded'?'Wartet auf Auswertung':'Erfasst'}</small></div><span className="badge-muted">Foto</span></div>) : <div className="empty-state"><Camera size={30}/><b>Noch keine Bons gespeichert.</b><span>Der erste Bon legt den Grundstein für eure Preisverläufe.</span></div>}</div></div><div className="notice-card"><Sparkles size={18}/><span>Aktuell speichern wir die Belegfotos sicher und legen sie zur Auswertung ab. Die automatische Texterkennung und Übernahme der einzelnen Artikelpreise ist der nächste technische Schritt – es werden noch keine Preise ungeprüft eingetragen.</span></div></section>}
        {tab === 'prices' && <section><div className="page-heading"><div><div className="eyebrow">CLEVER VERGLEICHEN</div><h1>Supermarktpreise</h1><p>Preisverlauf und Angebotsvergleich für Erfurt.</p></div><div className="heading-icon"><Store size={25}/></div></div><div className="retailer-grid">{[['ALDI Nord','aldi_nord'],['Lidl','lidl'],['REWE','rewe'],['Kaufland','kaufland'],['EDEKA','edeka']].map(([name,code])=><div className="retailer-card" key={code}><div className="retailer-logo">{name.slice(0,1)}</div><b>{name}</b><span>Erfurt · Preisquelle vorbereitet</span><small>Erste Preiserfassung steht noch aus</small></div>)}</div><div className="notice-card"><Store size={19}/><span>Die monatliche Erfassung ist vorbereitet. Preise erscheinen erst, wenn sie mit einer nachvollziehbaren Quelle erfasst und geprüft wurden. ALDI Süd wird nicht als Erfurter Filiale gewertet.</span></div></section>}
        {tab === 'settings' && <section><div className="page-heading"><div><div className="eyebrow">EURE HAUSHALTSREGELN</div><h1>Einstellungen</h1><p>So soll BLANKMANN für euch planen.</p></div><div className="heading-icon"><Settings2 size={25}/></div></div><form className="panel settings-panel" onSubmit={saveSettings}><div className="setting-block"><span className="eyebrow">BUDGET</span><h2>Wöchentliches Einkaufsbudget</h2><label className="budget-input"><span>€</span><input name="weekly_budget" type="number" min="1" step="1" defaultValue={budget}/></label></div><div className="setting-block"><span className="eyebrow">ESSENSVORLIEBEN</span><h2>Was sollen wir berücksichtigen?</h2><Toggle name="histamine_low_enabled" label="Histaminbewusst planen" description="Möglichst histaminarme Zutaten bevorzugen." checked={settings?.histamine_low_enabled??true}/><Toggle name="tomato_free_enabled" label="Tomatenfrei" description="Auch versteckte Tomatenzutaten in Saucen und Fertigprodukten meiden." checked={settings?.tomato_free_enabled??true}/><Toggle name="cream_free_enabled" label="Ohne Sahne" description="Gerichte standardmäßig ohne Sahne planen." checked={settings?.cream_free_enabled??true}/><Toggle name="vegetable_rich_enabled" label="Gemüsereich" description="Gemüse soll einen großen Teil der Mahlzeiten ausmachen." checked={settings?.vegetable_rich_enabled??true}/></div><div className="setting-block"><label>Weitere Hinweise<textarea name="dietary_notes" defaultValue={settings?.dietary_notes??''} placeholder="Weitere Zutaten, die ihr meidet, Vorlieben, Hinweise …"/></label></div><button className="button button-dark">Einstellungen speichern</button></form></section>}
      </div>
      <footer className="footer"><span>BLANKMANN <i>·</i> Gemeinsam gut versorgt.</span><span>Mit Liebe geplant.</span></footer>
    </main>
  </div>
}

function Stat({icon:Icon,label,value,sub}:{icon:typeof Sprout;label:string;value:string;sub:string}) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><Icon size={18}/></div><strong>{value}</strong><small>{sub}</small></div>
}

function Toggle({name,label,description,checked}:{name:string;label:string;description:string;checked:boolean}) {
  const [on,setOn] = useState(checked)
  useEffect(()=>setOn(checked),[checked])
  return <label className="toggle-row"><span><b>{label}</b><small>{description}</small></span><input type="checkbox" name={name} checked={on} onChange={e=>setOn(e.target.checked)}/><i className="toggle-switch"/></label>
}

function AuthScreen() {
  const [mode,setMode] = useState<'login'|'signup'>('login')
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!supabase)return
    const data=new FormData(e.currentTarget); const email=String(data.get('email')); const password=String(data.get('password'))
    setBusy(true);setError('');setMessage('')
    const result=mode==='login'?await supabase.auth.signInWithPassword({email,password}):await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin,data:{display_name:String(data.get('display_name')||'')}}})
    setBusy(false)
    if(result.error)setError(result.error.message)
    else if(mode==='signup'&&!result.data.session)setMessage('Fast geschafft! Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach.')
    else setMessage('Anmeldung erfolgreich.')
  }
  return <div className="auth-layout"><div className="auth-brand"><div className="brand-mark">B.</div><span>BLANKMANN</span><small>FOODPLANNER</small></div><div className="auth-card"><span className="eyebrow">WILLKOMMEN ZUHAUSE</span><h1>{mode==='login'?'Schön, dass du da bist.':'Euer gemeinsamer Start.'}</h1><p>Einfach besser planen. Gemeinsam weniger verschwenden.</p>{error&&<div className="alert error">{error}</div>}{message&&<div className="alert success">{message}</div>}<form className="stack-form" onSubmit={submit}>{mode==='signup'&&<label>Dein Name<input name="display_name" placeholder="Wie dürfen wir dich nennen?"/></label>}<label>E-Mail-Adresse<input name="email" type="email" placeholder="name@beispiel.de" required/></label><label>Passwort<input name="password" type="password" minLength={8} placeholder="Mindestens 8 Zeichen" required/></label><button className="button button-dark button-full" disabled={busy}>{busy?'Einen Moment …':mode==='login'?'Anmelden':'Konto erstellen'} <span>→</span></button></form><div className="auth-switch">{mode==='login'?'Noch kein Konto?':'Schon registriert?'} <button onClick={()=>{setMode(mode==='login'?'signup':'login');setError('');setMessage('')}}>{mode==='login'?'Jetzt registrieren':'Zum Login'}</button></div><small className="privacy-note">Deine Daten bleiben in eurem privaten Haushalt.</small></div><div className="auth-bottom">GUT ESSEN. GUT PLANEN. GUT ZUSAMMENLEBEN.</div></div>
}

function HouseholdSetup({user,onCreated}:{user:User;onCreated:()=>Promise<void>}) {
  const [name,setName]=useState('Blankmann Zuhause')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function create(e:FormEvent) {
    e.preventDefault();if(!supabase)return
    setBusy(true);setError('')
    const profile=await supabase.from('profiles').upsert({id:user.id,display_name:user.user_metadata?.display_name||user.email?.split('@')[0]||'Mitglied'})
    if(profile.error){setBusy(false);setError(profile.error.message);return}
    const home=await supabase.from('households').insert({name,created_by:user.id}).select('id').single()
    if(home.error){setBusy(false);setError(home.error.message);return}
    const member=await supabase.from('household_members').insert({household_id:home.data.id,user_id:user.id,role:'owner'})
    if(member.error){setBusy(false);setError(member.error.message);return}
    const prefs=await supabase.from('household_settings').insert({household_id:home.data.id,weekly_budget:100,currency:'EUR',histamine_low_enabled:true,tomato_free_enabled:true,cream_free_enabled:true,vegetable_rich_enabled:true})
    setBusy(false)
    if(prefs.error){setError(prefs.error.message);return}
    await onCreated()
  }
  return <div className="auth-layout"><div className="auth-brand"><div className="brand-mark">B.</div><span>BLANKMANN</span><small>FOODPLANNER</small></div><div className="auth-card"><span className="eyebrow">EUER ZUHAUSE</span><h1>Für wen planen wir?</h1><p>Erstelle euren gemeinsamen Haushalt. Danach kannst du Sophia einladen.</p>{error&&<div className="alert error">{error}</div>}<form className="stack-form" onSubmit={create}><label>Name eures Haushalts<input value={name} onChange={e=>setName(e.target.value)} required/></label><button className="button button-dark button-full" disabled={busy}>{busy?'Haushalt wird erstellt …':'Haushalt einrichten →'}</button></form><div className="privacy-note">Angemeldet als {user.email}</div></div><div className="auth-bottom">GUT ESSEN. GUT PLANEN. GUT ZUSAMMENLEBEN.</div></div>
}

function SetupScreen() {
  return <div className="loading-screen"><div className="brand-mark">B.</div><h1>BLANKMANN</h1><p>Die Verbindung zur Datenbank fehlt noch.</p><div className="setup-instructions">Bitte trage in deiner Hosting-Umgebung die Variablen <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> ein. Die Vorlage liegt in <code>.env.example</code>.</div></div>
}
