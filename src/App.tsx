import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Apple, BookOpen, CalendarDays, Check, ChevronDown, CircleDollarSign, ReceiptText, Edit3, Trash2,
  CookingPot, Leaf, ListChecks, LogOut, Plus, Search, Settings2, ShoppingBasket,
  Sparkles, Sprout, Store, Warehouse, X, Smartphone, Tablet,
} from 'lucide-react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import ReceiptScanner from './components/ReceiptScanner'
import RecipeDetails from './components/RecipeDetails'
import ManualPriceForm from './components/ManualPriceForm'
import IngredientPicker from './components/IngredientPicker'
import { baseKey, canSplitToOne, estimateCost, estimateRecipeCost, formatAmount, fromBase, instructionSteps, sameKind, splitOrganic, splitToOne, toBase, type CostLine } from './lib/kitchen'
import { retailerCards, retailerName } from './lib/retailers'
import { compareAisles, foodCategories } from './lib/categories'
import { completeRecipeWithAi } from './lib/recipeAiClient'
import { isThermomix } from './lib/recipeAi'
import { shrinkImage } from './lib/image'
import { localISO } from './lib/dates'

type Tab = 'overview' | 'planner' | 'shopping' | 'pantry' | 'foods' | 'recipes' | 'prices' | 'receipts' | 'settings'
type Household = { id: string; name: string }
type Settings = {
  weekly_budget: number
  histamine_low_enabled: boolean
  tomato_free_enabled: boolean
  cream_free_enabled: boolean
  vegetable_rich_enabled: boolean
  dietary_notes: string | null
  prefer_organic?: boolean
}
type PlanCheck = { id: string; item_key: string; checked: boolean; hidden: boolean }
type ShoppingItem = { id: string; name: string; quantity: number | null; unit: string | null; aisle: string | null; checked: boolean; estimated_price: number | null; actual_price: number | null }
type PantryItem = { id: string; name: string; quantity: number | null; unit: string | null; best_before: string | null; storage_location: string | null; food_item_id: string | null; is_organic?: boolean | null }
type FoodItem = { id: string; name: string; normalized_name: string; category: string; default_unit: string | null; notes: string | null; source_name: string; is_staple?: boolean | null }
type FoodPrice = { id: string; food_item_id: string; retailer_code: string; price_eur: number; package_quantity: number | null; package_unit: string | null; unit_price_eur: number | null; unit_label: string | null; price_type: string; source_name: string; source_url: string | null; observed_at: string; is_organic?: boolean | null }
type Meal = { id: string; meal_date: string; meal_type: string; custom_title: string | null; recipe_id: string | null; servings: number; food_item_id: string | null; quantity: number | null; unit: string | null; cooked_at: string | null }
type RecipeIngredient = { id: string; food_item_id: string | null; name: string; quantity: number | null; unit: string | null; aisle: string | null; is_optional: boolean; ai_added?: boolean | null }
type Recipe = { id: string; title: string; description: string | null; source_type?: string | null; source_url?: string | null; servings: number; prep_minutes: number | null; cook_minutes: number | null; notes: string | null; instructions?: unknown; histamine_score?: number | null; histamine_note?: string | null; rating?: number | null; photo_path?: string | null; recipe_ingredients?: RecipeIngredient[] }


const nav: { id: Tab; label: string; icon: typeof CalendarDays }[] = [
  { id: 'overview', label: 'Übersicht', icon: Sprout },
  { id: 'planner', label: 'Wochenplan', icon: CalendarDays },
  { id: 'shopping', label: 'Einkaufsliste', icon: ShoppingBasket },
  { id: 'receipts', label: 'Bon scannen', icon: ReceiptText },
  { id: 'pantry', label: 'Vorrat', icon: Warehouse },
  { id: 'foods', label: 'Nahrungsmittel', icon: Apple },
  { id: 'recipes', label: 'Rezepte', icon: BookOpen },
  { id: 'prices', label: 'Preise', icon: Store },
]

const euro = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n)
const todayISO = () => localISO()
const mondayISO = (date = new Date()) => {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return localISO(d)
}
const weekDates = (start: string) => Array.from({ length: 7 }, (_, i) => {
  const d = new Date(start + 'T12:00:00')
  d.setDate(d.getDate() + i)
  return d
})
const shortDate = (d: Date) => new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit' }).format(d)
const friendlyError = (error: unknown) => error instanceof Error ? error.message : 'Das hat gerade nicht geklappt.'
const mealLabel = (type: string) => (({ breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', week: 'Ganze Woche' } as Record<string, string>)[type] ?? type)
const mealTypeValue = (label: string) => (({ Frühstück: 'breakfast', Mittagessen: 'lunch', Abendessen: 'dinner' } as Record<string, string>)[label] ?? 'dinner')

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [household, setHousehold] = useState<Household | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shopping, setShopping] = useState<ShoppingItem[]>([])
  const [shoppingView, setShoppingView] = useState<'check' | 'edit' | 'recipes'>('check')
  const [planChecks, setPlanChecks] = useState<PlanCheck[]>([])
  const [aiProgress, setAiProgress] = useState('')
  const [recipeSort, setRecipeSort] = useState<'standard' | 'histamine-desc' | 'histamine-asc' | 'rating-desc' | 'rating-asc'>('standard')
  const [pantry, setPantry] = useState<PantryItem[]>([])
  const [foods, setFoods] = useState<FoodItem[]>([])
  const [foodPrices, setFoodPrices] = useState<FoodPrice[]>([])
  const [foodSearch, setFoodSearch] = useState('')
  // Zugeklappte Gruppen im Katalog – pro Gerät gemerkt.
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('blankmann-food-collapsed') || '[]') as string[] } catch { return [] } })
  const saveCollapsed = (next: string[]) => { setCollapsedGroups(next); try { localStorage.setItem('blankmann-food-collapsed', JSON.stringify(next)) } catch { /* nur Komfort */ } }
  const [meals, setMeals] = useState<Meal[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  // Rezeptfotos liegen privat; für die Anzeige gibt es zeitlich begrenzte Links (nur für neue Fotos neu angefordert).
  const photoPaths = recipes.map(r => r.photo_path).filter((p): p is string => Boolean(p)).sort().join('|')
  useEffect(() => {
    const client = supabase
    const missing = photoPaths ? photoPaths.split('|').filter(path => !photoUrls[path]) : []
    if (!client || !missing.length) return
    client.storage.from('recipe-photos').createSignedUrls(missing, 60 * 60 * 12).then(({ data }) => {
      const fresh: Record<string, string> = {}
      for (const item of data ?? []) if (item.path && item.signedUrl) fresh[item.path] = item.signedUrl
      if (Object.keys(fresh).length) setPhotoUrls(current => ({ ...current, ...fresh }))
    })
  }, [photoPaths]) // eslint-disable-line react-hooks/exhaustive-deps
  const [editingMealId, setEditingMealId] = useState<string | null>(null)
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null)
  const [newRecipePicker, setNewRecipePicker] = useState(0)
  const [details, setDetails] = useState<{ recipeId: string; mealId: string | null } | null>(null)
  const [slotForm, setSlotForm] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState(mondayISO())
  const [listId, setListId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
    const [shop, stock, plan, recipeRows, foodRows, priceRows, checks] = await Promise.all([
      supabase.from('shopping_list_items').select('*').eq('shopping_list_id', activeList.id).order('created_at'),
      supabase.from('pantry_items').select('*').eq('household_id', household.id).order('best_before', { ascending: true, nullsFirst: false }),
      supabase.from('weekly_plans').select('id').eq('household_id', household.id).eq('week_start', weekStart).maybeSingle(),
      supabase.from('recipes').select('id,title,description,source_type,source_url,servings,prep_minutes,cook_minutes,notes,instructions,histamine_score,histamine_note,rating,photo_path,recipe_ingredients(id,food_item_id,name,quantity,unit,aisle,is_optional,ai_added)').eq('household_id', household.id).order('created_at', { ascending: false }),
      supabase.from('household_foods').select('id,name,normalized_name,category,default_unit,notes,source_name,is_staple').eq('household_id', household.id).order('category').order('name'),
      supabase.from('household_food_prices').select('id,food_item_id,retailer_code,price_eur,package_quantity,package_unit,unit_price_eur,unit_label,price_type,source_name,source_url,observed_at,is_organic').eq('household_id', household.id).order('observed_at', { ascending: false }),
      supabase.from('shopping_plan_checks').select('id,item_key,checked,hidden').eq('household_id', household.id).eq('week_start', weekStart),
    ])
    if (shop.error) throw shop.error
    if (stock.error) throw stock.error
    if (plan.error) throw plan.error
    if (recipeRows.error) throw recipeRows.error
    if (foodRows.error) throw foodRows.error
    if (priceRows.error) throw priceRows.error
    if (checks.error) throw checks.error
    setPlanChecks((checks.data ?? []) as PlanCheck[])
    setFoods((foodRows.data ?? []) as FoodItem[])
    setFoodPrices((priceRows.data ?? []) as FoodPrice[])
    setRecipes((recipeRows.data ?? []) as Recipe[])
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_foods', filter: 'household_id=eq.' + household.id }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_plan_checks', filter: 'household_id=eq.' + household.id }, () => refreshData())
      .subscribe()
    return () => { client.removeChannel(channel) }
  }, [household, refreshData])

  const budget = Number(settings?.weekly_budget ?? 100)
  // „Bio bevorzugen“ (Einstellungen): Schätzungen rechnen mit Bio-Preisen, sonst mit normalen (Mittelwert über die Märkte).
  const priceOptions = { preferOrganic: Boolean(settings?.prefer_organic) }

  async function signOut() { await supabase?.auth.signOut() }

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
      household_id: household.id, shopping_list_id: listId, name, normalized_name: name.toLocaleLowerCase('de-DE').trim(), quantity: form.get('quantity') ? Number(form.get('quantity')) : null,
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

  async function addPantryItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !household) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const split = splitOrganic(String(form.get('name') ?? '').trim())
    const name = split.base
    if (!name) return
    // Bio ist ein Merkmal: „Bio Eier“ wird als „Eier“ (Bio) gespeichert und zählt für Rezepte wie normale Eier.
    const food = foods.find(f => baseKey(f.name) === baseKey(name))
    const { error: insertError } = await supabase.from('pantry_items').insert({
      household_id: household.id, name: food?.name ?? name, food_item_id: food?.id ?? null, is_organic: split.organic || form.get('is_organic') === 'on', quantity: form.get('quantity') ? Number(form.get('quantity')) : null,
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
    const recipeId = String(form.get('recipe_id') || '') || null
    const selectedRecipe = recipeId ? recipes.find(r => r.id === recipeId) : null
    const title = String(form.get('title') ?? '').trim() || selectedRecipe?.title || ''
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
      meal_type: mealTypeValue(String(form.get('meal_type'))), custom_title: title, recipe_id: recipeId, servings: Number(form.get('servings') || 2),
    })
    setBusy(false)
    if (mealError) setError(mealError.message); else { formElement.reset(); await refreshData() }
  }

  async function ensureWeeklyPlan(userId: string): Promise<string | null> {
    if (!supabase || !household) return null
    const plan = await supabase.from('weekly_plans').select('id').eq('household_id', household.id).eq('week_start', weekStart).maybeSingle()
    if (plan.error) { setError(plan.error.message); return null }
    if (plan.data) return plan.data.id as string
    const created = await supabase.from('weekly_plans').insert({ household_id: household.id, week_start: weekStart, budget, created_by: userId }).select('id').single()
    if (created.error) { setError(created.error.message); return null }
    return created.data.id as string
  }

  // Einzelnes Nahrungsmittel einplanen: in einer Mahlzeit (Tag + Frühstück/Mittag/Abend) oder für die ganze Woche.
  async function addFoodEntry(e: FormEvent<HTMLFormElement>, date: string, type: string) {
    e.preventDefault()
    const currentUser = session?.user
    if (!supabase || !household || !currentUser) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const name = String(form.get('food') || '').trim().toLocaleLowerCase('de-DE')
    const food = foods.find(f => f.name.toLocaleLowerCase('de-DE') === name)
    if (!food) { setError('Bitte ein Nahrungsmittel aus der Vorschlagsliste wählen – neue Nahrungsmittel unter „Nahrungsmittel“ anlegen.'); return }
    const quantityText = String(form.get('quantity') || '').replace(',', '.').trim()
    const quantity = quantityText ? Number(quantityText) : null
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) { setError('Bitte eine gültige Menge eintragen oder das Feld leer lassen.'); return }
    const unit = String(form.get('unit') || '').trim() || food.default_unit || null
    setBusy(true); setError('')
    const planId = await ensureWeeklyPlan(currentUser.id)
    if (!planId) { setBusy(false); return }
    const { error: insertError } = await supabase.from('meal_plan_entries').insert({
      household_id: household.id, weekly_plan_id: planId, meal_date: date, meal_type: type, custom_title: food.name, recipe_id: null,
      food_item_id: food.id, quantity, unit, servings: 1,
    })
    setBusy(false)
    if (insertError) { setError(insertError.message); return }
    formElement.reset(); setSlotForm(null); setNotice(food.name + ' eingeplant.'); await refreshData()
  }

  // Abhaken im Gesamteinkauf: manuelle Artikel direkt, Artikel aus dem Wochenplan über shopping_plan_checks (pro Woche).
  async function toggleGroup(group: ShoppingGroup) {
    if (!supabase || !household) return
    const next = !group.checked
    if (group.manualRows.length) {
      const { error: updateError } = await supabase.from('shopping_list_items').update({ checked: next }).in('id', group.manualRows.map(row => row.id)).eq('household_id', household.id)
      if (updateError) { setError(updateError.message); return }
    }
    if (group.fromPlan) {
      const { error: checkError } = await supabase.from('shopping_plan_checks').upsert({ household_id: household.id, week_start: weekStart, item_key: group.key, checked: next, hidden: false, updated_at: new Date().toISOString() }, { onConflict: 'household_id,week_start,item_key' })
      if (checkError) { setError(checkError.message); return }
    }
    await refreshData()
  }

  async function deleteCheckedShopping() {
    if (!supabase || !household) return
    const checked = visibleShopping.filter(group => group.checked)
    if (!checked.length) return
    const label = checked.length === 1 ? 'das Element „' + checked[0].name + '“' : 'die ' + checked.length + ' abgehakten Elemente'
    if (!window.confirm('Sicher, dass du ' + label + ' von der Einkaufsliste löschen willst? Artikel aus dem Wochenplan werden für diese Woche ausgeblendet.')) return
    const manualIds = checked.flatMap(group => group.manualRows.map(row => row.id))
    if (manualIds.length) {
      const { error: deleteError } = await supabase.from('shopping_list_items').delete().in('id', manualIds).eq('household_id', household.id)
      if (deleteError) { setError(deleteError.message); return }
    }
    const planned = checked.filter(group => group.fromPlan)
    if (planned.length) {
      const { error: hideError } = await supabase.from('shopping_plan_checks').upsert(planned.map(group => ({ household_id: household.id, week_start: weekStart, item_key: group.key, checked: true, hidden: true, updated_at: new Date().toISOString() })), { onConflict: 'household_id,week_start,item_key' })
      if (hideError) { setError(hideError.message); return }
    }
    setNotice(checked.length + ' abgehakte Artikel entfernt.'); await refreshData()
  }

  async function showHiddenShopping() {
    if (!supabase || !household) return
    const { error: updateError } = await supabase.from('shopping_plan_checks').update({ hidden: false, checked: false, updated_at: new Date().toISOString() }).eq('household_id', household.id).eq('week_start', weekStart).eq('hidden', true)
    if (updateError) setError(updateError.message); else await refreshData()
  }

  // Bearbeiten im Gesamteinkauf: fehlende Mengen dort eintragen, wo sie herkommen (Rezept, eingeplantes Nahrungsmittel, manueller Artikel).
  const readAmount = (form: FormData) => {
    const text = String(form.get('quantity') || '').replace(',', '.').trim()
    const quantity = text ? Number(text) : null
    return { quantity: quantity !== null && Number.isFinite(quantity) && quantity > 0 ? quantity : null, invalid: Boolean(text) && !(Number(text) > 0), unit: String(form.get('unit') || '').trim() || null }
  }
  async function saveIngredientAmount(e: FormEvent<HTMLFormElement>, ingredientId: string) {
    e.preventDefault()
    if (!supabase || !household) return
    const amount = readAmount(new FormData(e.currentTarget))
    if (amount.invalid || amount.quantity === null) { setError('Bitte eine Menge über 0 eintragen.'); return }
    const { error: updateError } = await supabase.from('recipe_ingredients').update({ quantity: amount.quantity, unit: amount.unit }).eq('id', ingredientId).eq('household_id', household.id)
    if (updateError) setError(updateError.message); else { setNotice('Menge im Rezept gespeichert.'); await refreshData() }
  }
  async function saveFoodEntryAmount(e: FormEvent<HTMLFormElement>, mealId: string) {
    e.preventDefault()
    if (!supabase || !household) return
    const amount = readAmount(new FormData(e.currentTarget))
    if (amount.invalid || amount.quantity === null) { setError('Bitte eine Menge über 0 eintragen.'); return }
    const { error: updateError } = await supabase.from('meal_plan_entries').update({ quantity: amount.quantity, unit: amount.unit }).eq('id', mealId).eq('household_id', household.id)
    if (updateError) setError(updateError.message); else { setNotice('Menge im Wochenplan gespeichert.'); await refreshData() }
  }
  async function saveManualItem(e: FormEvent<HTMLFormElement>, item: ShoppingItem) {
    e.preventDefault()
    if (!supabase || !household) return
    const amount = readAmount(new FormData(e.currentTarget))
    if (amount.invalid) { setError('Bitte eine gültige Menge eintragen oder das Feld leer lassen.'); return }
    const { error: updateError } = await supabase.from('shopping_list_items').update({ quantity: amount.quantity, unit: amount.unit }).eq('id', item.id).eq('household_id', household.id)
    if (updateError) setError(updateError.message); else { setNotice(item.name + ' gespeichert.'); await refreshData() }
  }
  async function deleteShoppingItem(item: ShoppingItem) {
    if (!supabase || !household || !window.confirm('Sicher, dass du das Element „' + item.name + '“ von der Einkaufsliste löschen willst?')) return
    const { error: deleteError } = await supabase.from('shopping_list_items').delete().eq('id', item.id).eq('household_id', household.id)
    if (deleteError) setError(deleteError.message); else await refreshData()
  }

  // KI ergänzt Anleitung + fehlende Mengen (einzeln nach dem Anlegen oder für alle unvollständigen Rezepte).
  const recipeIncomplete = (recipe: Recipe) => !instructionSteps(recipe.instructions).length || (recipe.recipe_ingredients ?? []).some(i => i.quantity === null) || recipe.prep_minutes === null || recipe.cook_minutes === null || !recipe.histamine_score
  async function completeRecipes(targets: Recipe[]) {
    if (!household || !session || !targets.length) return
    setError('')
    let done = 0
    let added = 0
    const failures: string[] = []
    for (const recipe of targets) {
      setAiProgress('KI ergänzt „' + recipe.title + '“ (' + (done + 1) + ' von ' + targets.length + ') …')
      // Neue Anleitung → die KI darf auch fehlende Zutaten/Gewürze ergänzen (markiert mit „KI“).
      try { const result = await completeRecipeWithAi(recipe.id, household.id, session.access_token, !instructionSteps(recipe.instructions).length); added += result.added.length; done++ }
      catch (aiError) { failures.push(recipe.title + ': ' + friendlyError(aiError)); if (/nicht verbunden|Tageskontingent/.test(friendlyError(aiError))) break }
    }
    setAiProgress('')
    await refreshData()
    if (done) setNotice(done + ' Rezept(e) mit KI ergänzt (Anleitung, fehlende Mengen, Kochzeiten und Histaminwert' + (added ? ', ' + added + ' zusätzliche Zutat(en)/Gewürze – mit „KI“ markiert, beim Bearbeiten entfernbar' : '') + '). Alles bleibt bearbeitbar.')
    if (failures.length) setError('KI-Ergänzung nicht möglich – ' + failures.join(' · '))
  }

  // Tab „Preise“: gespeicherten Preis auf 1 Stück runterrechnen (z. B. 2 Stk für 3,00 € → 1 Stk für 1,50 €).
  async function splitExistingPrice(price: FoodPrice, foodName: string) {
    if (!supabase || !household) return
    const quantity = Number(price.package_quantity)
    if (!canSplitToOne(quantity, price.package_unit)) return
    const one = splitToOne(Number(price.price_eur), quantity, price.package_unit)
    const { error: updateError } = await supabase.from('household_food_prices').update({ price_eur: one.price, package_quantity: 1, package_unit: one.unit }).eq('id', price.id).eq('household_id', household.id)
    if (updateError) { setError(updateError.message); return }
    setNotice(foodName + ' (' + retailerName(price.retailer_code) + '): ' + euro(Number(price.price_eur)) + ' für ' + formatAmount(quantity, price.package_unit) + ' → ' + euro(one.price) + ' für 1 ' + one.unit + '.')
    await refreshData()
  }

  // Grundausstattung (Salz, Öl, Gewürze …): Kennzeichen am Nahrungsmittel. Steht trotzdem auf der Einkaufsliste (Vorrat wird abgezogen).
  async function toggleStaple(food: FoodItem) {
    if (!supabase || !household) return
    const { error: updateError } = await supabase.from('household_foods').update({ is_staple: !food.is_staple }).eq('id', food.id).eq('household_id', household.id)
    if (updateError) { setError(updateError.message); return }
    setNotice(food.name + (food.is_staple ? ' ist keine Grundausstattung mehr.' : ' ist jetzt Grundausstattung.')); await refreshData()
  }
  const isStapleName = (name: string) => Boolean(foods.find(f => baseKey(f.name) === baseKey(name))?.is_staple)

  // Gruppe eines Nahrungsmittels von Hand ändern. Die Zutaten in Rezepten ziehen mit (Einkaufsliste nutzt ohnehin die aktuelle Gruppe).
  async function changeFoodCategory(food: FoodItem, category: string) {
    if (!supabase || !household || category === food.category) return
    const { error: updateError } = await supabase.from('household_foods').update({ category }).eq('id', food.id).eq('household_id', household.id)
    if (updateError) { setError(updateError.message); return }
    await supabase.from('recipe_ingredients').update({ aisle: category }).eq('food_item_id', food.id).eq('household_id', household.id)
    setNotice(food.name + ' steht jetzt unter „' + category + '“.'); await refreshData()
  }

  async function deletePantryItem(item: PantryItem) {
    if (!supabase || !household || !window.confirm('Sicher, dass du das Element „' + item.name + '“ aus dem Vorrat löschen willst?')) return
    const { error: deleteError } = await supabase.from('pantry_items').delete().eq('id', item.id).eq('household_id', household.id)
    if (deleteError) setError(deleteError.message); else { setNotice(item.name + ' aus dem Vorrat gelöscht.'); await refreshData() }
  }

  function openDetails(recipeId: string, mealId: string | null) {
    setDetails({ recipeId, mealId })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveMealEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !household || !editingMealId) return
    const form = new FormData(e.currentTarget)
    const recipeId = String(form.get('recipe_id') || '') || null
    const selectedRecipe = recipeId ? recipes.find(r => r.id === recipeId) : null
    const title = String(form.get('title') || '').trim() || selectedRecipe?.title || ''
    if (!title) { setError('Bitte gib dem Gericht einen Namen oder wähle ein Rezept.'); return }
    setBusy(true); setError('')
    const { error: updateError } = await supabase.from('meal_plan_entries').update({
      meal_date: String(form.get('meal_date')), meal_type: String(form.get('meal_type')),
      custom_title: title, recipe_id: recipeId, servings: Number(form.get('servings') || 2),
      ...(form.has('quantity') ? { quantity: String(form.get('quantity') || '').trim() ? Number(String(form.get('quantity')).replace(',', '.')) : null, unit: String(form.get('unit') || '').trim() || null } : {}),
    }).eq('id', editingMealId).eq('household_id', household.id)
    setBusy(false)
    if (updateError) { setError(updateError.message); return }
    setEditingMealId(null); setNotice('Gericht im Wochenplan aktualisiert.'); await refreshData()
  }

  async function deleteMeal(meal: Meal) {
    if (!supabase || !window.confirm(`Sicher, dass du das Element „${meal.custom_title || 'Dieses Gericht'}“ aus dem Wochenplan löschen willst?`)) return
    const { error: deleteError } = await supabase.from('meal_plan_entries').delete().eq('id', meal.id).eq('household_id', household!.id)
    if (deleteError) setError(deleteError.message); else { setEditingMealId(null); setNotice('Gericht aus dem Wochenplan entfernt.'); await refreshData() }
  }

  async function deleteRecipe(recipe: Recipe) {
    if (!supabase || !window.confirm(`Sicher, dass du das Element „Rezept: ${recipe.title}“ löschen willst? Bereits geplante Gerichte bleiben als freie Einträge im Wochenplan erhalten.`)) return
    const { error: deleteError } = await supabase.from('recipes').delete().eq('id', recipe.id).eq('household_id', household!.id)
    if (deleteError) setError(deleteError.message); else { setEditingRecipeId(null); setNotice('Rezept gelöscht. Geplante Gerichte bleiben im Wochenplan erhalten.'); await refreshData() }
  }

  // Histamin/Bewertung aus dem Bearbeiten-Formular (1–10, leer = kein Wert). Von Hand geänderter Histaminwert verliert die KI-Begründung.
  function scoreFields(form: FormData, recipe: Recipe) {
    const score = (name: string) => { const n = Number(String(form.get(name) || '').trim()); return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null }
    const histamine = score('histamine_score')
    const ratingValue = Number(String(form.get('rating') || '').replace(',', '.').trim())
    const rating = String(form.get('rating') || '').trim() && ratingValue >= 1 && ratingValue <= 10 ? Math.round(ratingValue * 10) / 10 : null
    return { histamine_score: histamine, rating, ...(histamine !== (recipe.histamine_score ?? null) ? { histamine_note: histamine === null ? null : 'Von Hand gesetzt' } : {}) }
  }

  async function saveRecipeEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !household || !editingRecipeId) return
    const recipe = recipes.find(r => r.id === editingRecipeId)
    if (!recipe) return
    const form = new FormData(e.currentTarget)
    const title = String(form.get('title') || '').trim()
    const foodIds = form.getAll('food_ids').map(String).filter(Boolean)
    if (!title || !foodIds.length) { setError('Bitte einen Namen und mindestens eine Zutat auswählen.'); return }
    setBusy(true); setError('')
    const { error: recipeError } = await supabase.from('recipes').update({ title, description: String(form.get('description') || '') || null, servings: Number(form.get('servings') || 2), prep_minutes: form.get('prep_minutes') ? Number(form.get('prep_minutes')) : null, cook_minutes: form.get('cook_minutes') ? Number(form.get('cook_minutes')) : null, ...scoreFields(form, recipe) }).eq('id', recipe.id).eq('household_id', household.id)
    if (recipeError) { setBusy(false); setError(recipeError.message); return }
    const oldIngredients = recipe.recipe_ingredients ?? []
    const rows = foods.filter(food => foodIds.includes(food.id)).map(food => {
      const existing = oldIngredients.find(item => item.food_item_id === food.id)
      const rawQuantity = String(form.get('quantity_' + food.id) || '').trim()
      const unit = String(form.get('unit_' + food.id) || food.default_unit || '').trim()
      return { ...(existing ? { id: existing.id } : {}), household_id: household.id, recipe_id: recipe.id, food_item_id: food.id, name: food.name, normalized_name: food.normalized_name, quantity: rawQuantity && Number.isFinite(Number(rawQuantity)) ? Number(rawQuantity) : null, unit: unit || null, aisle: food.category, is_optional: false, source_text: food.name }
    })
    // Bestehende Zutaten aktualisieren, neue einfügen. (Ein gemeinsamer upsert setzt bei neuen Zeilen id = null.)
    const existingRows = rows.filter(row => 'id' in row)
    const newRows = rows.filter(row => !('id' in row))
    const savedIngredients = existingRows.length ? await supabase.from('recipe_ingredients').upsert(existingRows) : { error: null }
    const addedIngredients = !savedIngredients.error && newRows.length ? await supabase.from('recipe_ingredients').insert(newRows) : { error: null }
    const ingredientError = savedIngredients.error ?? addedIngredients.error
    if (ingredientError) { setBusy(false); setError('Rezeptdaten gespeichert, Zutaten konnten aber nicht aktualisiert werden: ' + ingredientError.message); await refreshData(); return }
    const removedIds = oldIngredients.filter(item => !foodIds.includes(item.food_item_id || '')).map(item => item.id)
    if (removedIds.length) {
      const removed = await supabase.from('recipe_ingredients').delete().in('id', removedIds).eq('household_id', household.id)
      if (removed.error) { setBusy(false); setError('Rezept gespeichert, aber entfernte Zutaten konnten nicht bereinigt werden: ' + removed.error.message); await refreshData(); return }
    }
    // Foto: neues hochladen (verkleinert) und altes löschen, oder auf Wunsch entfernen.
    const photo = form.get('photo')
    const oldPhoto = recipe.photo_path ?? null
    if (photo instanceof File && photo.size > 0) {
      const path = household.id + '/' + recipe.id + '-' + crypto.randomUUID() + '.jpg'
      const uploaded = await supabase.storage.from('recipe-photos').upload(path, await shrinkImage(photo), { contentType: 'image/jpeg', upsert: false })
      if (uploaded.error) { setBusy(false); setError('Rezept gespeichert, Foto konnte nicht hochgeladen werden: ' + uploaded.error.message); await refreshData(); return }
      const linked = await supabase.from('recipes').update({ photo_path: path }).eq('id', recipe.id).eq('household_id', household.id)
      if (linked.error) { await supabase.storage.from('recipe-photos').remove([path]); setBusy(false); setError('Rezept gespeichert, Foto konnte nicht verknüpft werden: ' + linked.error.message); await refreshData(); return }
      if (oldPhoto) await supabase.storage.from('recipe-photos').remove([oldPhoto])
    } else if (form.get('remove_photo') && oldPhoto) {
      const unlinked = await supabase.from('recipes').update({ photo_path: null }).eq('id', recipe.id).eq('household_id', household.id)
      if (unlinked.error) { setBusy(false); setError('Foto konnte nicht entfernt werden: ' + unlinked.error.message); await refreshData(); return }
      await supabase.storage.from('recipe-photos').remove([oldPhoto])
    }
    setBusy(false); setEditingRecipeId(null); setNotice('Rezept und Zutaten wurden aktualisiert.'); await refreshData()
  }

  async function addFood(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !household) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const split = splitOrganic(String(form.get('name') || '').trim())
    const name = split.base
    if (!name) return
    // Bio ist kein eigenes Nahrungsmittel: „Bio Eier“ → „Eier“. Bio wird beim Preis und im Vorrat vermerkt.
    const existing = foods.find(f => baseKey(f.name) === baseKey(name))
    if (existing) { formElement.reset(); setNotice('„' + existing.name + '“ gibt es schon im Katalog.' + (split.organic ? ' Bio ist ein Merkmal – beim Preis oder im Vorrat einfach „Bio“ anhaken.' : '')); return }
    const result = await supabase.from('household_foods').insert({ household_id: household.id, name, normalized_name: name.toLocaleLowerCase('de-DE'), category: String(form.get('category') || 'Sonstiges'), default_unit: String(form.get('default_unit') || '') || null, notes: String(form.get('notes') || '') || null, source_name: 'Manuell', created_by: session?.user.id })
    if (result.error) { setError(result.error.message); return }
    formElement.reset(); setNotice(name + ' wurde hinzugefügt.' + (split.organic ? ' Bio ist ein Merkmal – beim Preis oder im Vorrat „Bio“ anhaken.' : '')); await refreshData()
  }

  async function addRecipe(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const currentUser = session?.user
    if (!supabase || !household || !currentUser) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const title = String(form.get('title') || '').trim()
    const foodIds = form.getAll('food_ids').map(String).filter(Boolean)
    if (!title) return
    if (!foodIds.length) { setError('Bitte mindestens ein Nahrungsmittel aus dem Katalog auswählen.'); return }
    setBusy(true); setError('')
    const created = await supabase.from('recipes').insert({ household_id: household.id, title, description: String(form.get('description') || '') || null, source_type: 'manual', servings: Number(form.get('servings') || 2), prep_minutes: form.get('prep_minutes') ? Number(form.get('prep_minutes')) : null, cook_minutes: form.get('cook_minutes') ? Number(form.get('cook_minutes')) : null, instructions: [], notes: null, created_by: currentUser.id }).select('id').single()
    if (created.error) { setBusy(false); setError(created.error.message); return }
    const rows = foods.filter(food => foodIds.includes(food.id)).map(food => { const rawQuantity = String(form.get('quantity_' + food.id) || '').trim(); const unit = String(form.get('unit_' + food.id) || food.default_unit || '').trim(); return { household_id: household.id, recipe_id: created.data.id, food_item_id: food.id, name: food.name, normalized_name: food.normalized_name, quantity: rawQuantity && Number.isFinite(Number(rawQuantity)) ? Number(rawQuantity) : null, unit: unit || null, aisle: food.category, is_optional: false, source_text: food.name } })
    const inserted = await supabase.from('recipe_ingredients').insert(rows)
    if (inserted.error) { setBusy(false); setError('Rezept gespeichert, Zutaten konnten nicht gespeichert werden: ' + inserted.error.message); await refreshData(); return }
    setBusy(false); formElement.reset(); setNewRecipePicker(k => k + 1); await refreshData()
    // Neues Rezept: Anleitung und fehlende Mengen automatisch von der KI ergänzen lassen.
    await completeRecipes([{ id: created.data.id, title, description: null, servings: Number(form.get('servings') || 2), prep_minutes: null, cook_minutes: null, notes: null, instructions: [], recipe_ingredients: [] }])
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
      prefer_organic: form.get('prefer_organic') === 'on',
    }
    const { error: saveError } = await supabase.from('household_settings').upsert(next, { onConflict: 'household_id' })
    if (saveError) setError(saveError.message); else { setSettings(next); setNotice('Einstellungen gespeichert.') }
  }

  const days = weekDates(weekStart)
  // Schlüssel eines Einkaufsartikels (Name ohne Bio + Einheit); gleicher Schlüssel wie bisher für Namen ohne „Bio“.
  const shoppingKey = (name: string, unit: string | null) => splitOrganic(name).base.toLocaleLowerCase('de-DE').trim() + '|' + (unit || '').toLocaleLowerCase('de-DE').trim()
  type DemandLine = { mealId: string; mealTitle: string; recipeTitle: string; name: string; quantity: number | null; unit: string | null; aisle: string; normalized: string; kind: 'recipe' | 'food'; recipeId: string | null; ingredientId: string | null; recipeServings: number }
  const recipeDemand = meals.flatMap((meal): DemandLine[] => {
    if (meal.food_item_id) {
      const food = foods.find(f => f.id === meal.food_item_id)
      const name = food?.name || meal.custom_title || ''
      return [{ mealId: meal.id, mealTitle: name, recipeTitle: 'Einzeln', name, quantity: meal.quantity === null ? null : Number(meal.quantity), unit: meal.unit, aisle: food?.category || 'Sonstiges', normalized: name.toLocaleLowerCase('de-DE').trim(), kind: 'food', recipeId: null, ingredientId: null, recipeServings: 1 }]
    }
    if (!meal.recipe_id) return []
    const recipe = recipes.find(r => r.id === meal.recipe_id)
    if (!recipe) return []
    return (recipe.recipe_ingredients ?? []).filter(ingredient => !ingredient.is_optional).map(ingredient => ({
      mealId: meal.id, mealTitle: recipe.title, recipeTitle: recipe.title, name: ingredient.name,
      quantity: ingredient.quantity === null ? null : Number(ingredient.quantity) * Number(meal.servings || recipe.servings) / Math.max(1, Number(recipe.servings || 1)),
      // Gruppe immer aktuell aus dem Nahrungsmittel-Katalog (Gruppenwechsel wirkt sofort), sonst die beim Anlegen kopierte.
      unit: ingredient.unit, aisle: foods.find(f => f.id === ingredient.food_item_id)?.category || ingredient.aisle || 'Sonstiges', normalized: (ingredient.name || '').toLocaleLowerCase('de-DE').trim(),
      kind: 'recipe', recipeId: recipe.id, ingredientId: ingredient.id, recipeServings: Number(recipe.servings || 1),
    }))
  })
  // Gesamteinkauf: Bedarf aus dem Wochenplan + manuelle Artikel, gleiche Artikel addiert, Vorrat (umgerechnet) abgezogen.
  type PlanLine = { kind: 'recipe' | 'food'; mealId: string; recipeId: string | null; recipeTitle: string; ingredientId: string | null; quantityMissing: boolean; recipeServings: number }
  const shoppingTotals = (() => {
    const groups = new Map<string, { key: string; name: string; unit: string | null; aisle: string; needed: number | null; pantry: number; manualRows: ShoppingItem[]; planLines: PlanLine[] }>()
    const groupFor = (rawName: string, unit: string | null, aisle: string) => {
      const name = splitOrganic(rawName).base
      const key = shoppingKey(rawName, unit)
      const current = groups.get(key) ?? { key, name, unit, aisle, needed: 0, pantry: 0, manualRows: [], planLines: [] }
      groups.set(key, current)
      return current
    }
    recipeDemand.forEach(line => {
      const group = groupFor(line.name, line.unit, line.aisle)
      group.needed = group.needed === null || line.quantity === null ? null : group.needed + line.quantity
      group.planLines.push({ kind: line.kind, mealId: line.mealId, recipeId: line.recipeId, recipeTitle: line.recipeTitle, ingredientId: line.ingredientId, quantityMissing: line.quantity === null, recipeServings: line.recipeServings })
    })
    shopping.forEach(item => {
      const group = groupFor(item.name, item.unit, item.aisle || 'Sonstiges')
      group.needed = group.needed === null || item.quantity === null ? null : group.needed + Number(item.quantity)
      group.manualRows.push(item)
    })
    for (const group of groups.values()) {
      // Bio und normal zählen gleich: „Bio Eier“ im Vorrat decken „Eier“ auf der Liste.
      const key = baseKey(group.name)
      group.pantry = pantry.filter(p => baseKey(p.name || '') === key && p.quantity !== null && sameKind(p.unit, group.unit))
        .reduce((sum, p) => sum + fromBase(toBase(Number(p.quantity), p.unit).quantity, group.unit), 0)
    }
    return Array.from(groups.values()).map(group => {
      const check = planChecks.find(c => c.item_key === group.key)
      const fromPlan = group.planLines.length > 0
      const checked = (fromPlan || group.manualRows.length > 0) && (!fromPlan || Boolean(check?.checked)) && group.manualRows.every(row => row.checked)
      const hidden = fromPlan && Boolean(check?.hidden) && group.manualRows.length === 0
      return { ...group, fromPlan, checked, hidden, pantry: Math.round(group.pantry * 1000) / 1000, toBuy: group.needed === null ? null : Math.max(0, Math.round((group.needed - group.pantry) * 1000) / 1000) }
    })
      .filter(group => group.needed === null || (group.toBuy ?? 0) > 0 || group.manualRows.length > 0)
      .sort((a,b) => compareAisles(a.aisle, b.aisle) || a.name.localeCompare(b.name, 'de-DE'))
  })()
  type ShoppingGroup = typeof shoppingTotals[number]
  const visibleShopping = shoppingTotals.filter(group => !group.hidden)
  const openCount = visibleShopping.filter(group => !group.checked).length
  const doneCount = visibleShopping.filter(group => group.checked).length
  const hiddenCount = shoppingTotals.filter(group => group.hidden).length
  // Gelöschte (ausgeblendete) Artikel verschwinden in allen Ansichten der Einkaufsliste.
  const hiddenKeys = new Set(shoppingTotals.filter(group => group.hidden).map(group => group.key))
  const showHiddenButton = hiddenCount > 0 && <button type="button" className="text-link" onClick={showHiddenShopping}>{hiddenCount} ausgeblendete wieder anzeigen</button>
  const amountText = (group: ShoppingGroup) => group.toBuy === null ? 'Menge offen' : `${Number(group.toBuy.toFixed(2))} ${group.unit || ''}`.trim()

  // Geschätzter Einkaufswert je geplantem Eintrag und Budget der Woche.
  const mealCosts = new Map<string, { cost: number | null; missing: CostLine[] }>()
  for (const meal of meals) {
    if (meal.food_item_id) {
      const line = estimateCost({ name: meal.custom_title || '', food_item_id: meal.food_item_id, quantity: meal.quantity === null ? null : Number(meal.quantity), unit: meal.unit }, foods, foodPrices, priceOptions)
      mealCosts.set(meal.id, { cost: line.cost, missing: line.basis === 'missing' ? [line] : [] })
    } else if (meal.recipe_id) {
      const recipe = recipes.find(r => r.id === meal.recipe_id)
      if (recipe) { const cost = estimateRecipeCost(recipe, meal.servings, foods, foodPrices, priceOptions); mealCosts.set(meal.id, { cost: cost.total, missing: cost.missing }) }
    }
  }
  const plannedTotal = Math.round([...mealCosts.values()].reduce((sum, c) => sum + (c.cost ?? 0), 0) * 100) / 100
  const budgetMissing = [...new Map([...mealCosts.values()].flatMap(c => c.missing).map(line => [line.foodId ?? line.name, line])).values()]
  const freeMeals = meals.filter(m => !m.recipe_id && !m.food_item_id).length
  const weekEntries = meals.filter(m => m.meal_type === 'week')
  const costLabel = (id: string) => { const c = mealCosts.get(id); return !c ? '' : c.cost === null ? 'Preis fehlt' : '≈ ' + euro(c.cost) + (c.missing.length ? ' · ' + c.missing.length + ' Preis fehlt' : '') }
  // Rezeptliste sortieren (nichts ausblenden). Rezepte ohne Wert stehen immer am Ende.
  const filteredRecipes = recipeSort === 'standard' ? recipes : [...recipes].sort((a, b) => {
    const field = recipeSort.startsWith('histamine') ? 'histamine_score' : 'rating'
    const va = a[field] == null ? null : Number(a[field]), vb = b[field] == null ? null : Number(b[field])
    if (va === null || vb === null) return va === null && vb === null ? a.title.localeCompare(b.title, 'de-DE') : va === null ? 1 : -1
    return (recipeSort.endsWith('desc') ? vb - va : va - vb) || a.title.localeCompare(b.title, 'de-DE')
  })
  // Einkaufsliste: prognostizierter Preis für die noch zu kaufende Menge (Vorrat schon abgezogen).
  const shoppingCost = (item: { name: string; unit: string | null; toBuy: number | null }) => item.toBuy === 0 ? null : estimateCost({ name: item.name, food_item_id: null, quantity: item.toBuy, unit: item.unit }, foods, foodPrices, priceOptions)
  const shoppingCostLines = visibleShopping.map(shoppingCost).filter((line): line is CostLine => line !== null)
  const shoppingTotal = Math.round(shoppingCostLines.reduce((sum, line) => sum + (line.cost ?? 0), 0) * 100) / 100
  const shoppingMissing = shoppingCostLines.filter(line => line.basis === 'missing').length
  const shoppingCostText = (line: CostLine | null) => !line ? '' : line.cost === null ? 'Preis fehlt' : '≈ ' + euro(line.cost) + (line.markets > 1 ? ' (Ø ' + line.markets + ' Märkte)' : '') + (line.organic ? ' · Bio' : '')

  return <div className={"app-shell theme-" + visualTheme + (deviceMode === "tablet" ? " device-tablet" : deviceMode === "phone" ? " device-phone" : "")}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">B.</div><div><strong>BLANKMANN</strong><span>FOODPLANNER</span></div></div>
      <div className="household-chip"><span className="online-dot" />{household.name}<ChevronDown size={14} /></div>
      <nav>{nav.map(item => <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { setTab(item.id); setError(''); setNotice(''); setDetails(null) }}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.id === 'shopping' && openCount > 0 && <small>{openCount}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="budget-mini"><div className="budget-mini-top"><span>Wochenbudget</span><strong>{euro(budget)}</strong></div><div className="progress"><i style={{ width: Math.min(100, plannedTotal / Math.max(1, budget) * 100) + '%' }} /></div><small>≈ {euro(plannedTotal)} verplant · {budget-plannedTotal>=0?'≈ '+euro(budget-plannedTotal)+' frei':'≈ '+euro(plannedTotal-budget)+' drüber'}</small></div><button className="profile-button" onClick={signOut}><div className="avatar">{(session.user.email?.[0] ?? 'B').toUpperCase()}</div><span><b>Mein Konto</b><small>Abmelden</small></span><LogOut size={16} /></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="topbar-left"><div className="build-meta"><b>BUILD 20.11.26-BC</b><span>VERSION 0.3.43</span></div><div className="breadcrumb">Dein Zuhause <span>/</span> {nav.find(n => n.id === tab)?.label}</div></div><div className="mobile-brand"><div className="brand-mark">B.</div><div className="mobile-brand-copy"><strong>BLANKMANN</strong><small>BUILD 20.11.26-BC</small><small>VERSION 0.3.43</small></div></div><div className="topbar-right"><span className="sync-status"><i /> Gemeinsam synchronisiert</span><button className="icon-button" aria-label="Einstellungen" onClick={() => setTab('settings')}><Settings2 size={19} /></button></div></header>
      <div className="page-wrap">
        {error && <div className="alert error"><span>{error}</span><button onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && <div className="alert success"><Check size={16}/>{notice}</div>}
        {details && (() => {
          const recipe = recipes.find(r => r.id === details.recipeId)
          const meal = details.mealId ? meals.find(m => m.id === details.mealId) ?? null : null
          return recipe ? <RecipeDetails key={recipe.id + (meal?.id ?? '')} photoUrl={recipe.photo_path ? photoUrls[recipe.photo_path] ?? null : null} recipe={recipe} meal={meal ? { id: meal.id, servings: meal.servings, cooked_at: meal.cooked_at, meal_date: meal.meal_date } : null} foods={foods} prices={foodPrices} preferOrganic={priceOptions.preferOrganic} pantry={pantry} householdId={household.id} accessToken={session.access_token} onChanged={refreshData} onClose={() => setDetails(null)} onNotice={setNotice} onError={setError} /> : null
        })()}
        {tab === 'overview' && <section>
          <div className="page-heading"><div><div className="eyebrow">{new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase()} · {new Date().getDay() === 1 ? 'DEIN WOCHENSTART' : 'DEINE WOCHE'}</div><h1>Was gibt’s diese Woche?</h1><p>Gemeinsam planen, entspannt einkaufen und nichts verschwenden.</p></div><div className="heading-icon"><Sprout size={25}/></div></div>
          <div className="stat-grid">
            <Stat icon={CircleDollarSign} label="Wochenbudget" value={euro(budget)} sub={(budget-plannedTotal>=0?'≈ '+euro(budget-plannedTotal)+' noch frei':'≈ '+euro(plannedTotal-budget)+' über Budget')+' · ≈ '+euro(plannedTotal)+' verplant'} warn={budget-plannedTotal<0} />
            <Stat icon={ShoppingBasket} label="Noch einzukaufen" value={String(openCount)} sub="Artikel auf deiner Liste" />
            <Stat icon={Warehouse} label="Im Vorrat" value={String(pantry.length)} sub="gespeicherte Zutaten" />
            <Stat icon={CookingPot} label="Geplante Mahlzeiten" value={String(meals.filter(m => !m.food_item_id).length)} sub="für diese Woche" />
          </div>
          <div className="content-grid">
            <div className="panel week-panel"><div className="panel-head"><div><span className="eyebrow">DEIN SPEISEPLAN</span><h2>Diese Woche</h2></div><button className="text-link" onClick={() => setTab('planner')}>Plan öffnen <span>→</span></button></div>
              <div className="week-strip">{days.map(d => <button key={d.toISOString()} onClick={() => setTab('planner')} className={localISO(d) === todayISO() ? 'day-pill today' : 'day-pill'}><b>{shortDate(d).split(',')[0]}</b><span>{d.getDate()}</span></button>)}</div>
              {meals.length ? <div className="meal-preview">{meals.filter(m => m.meal_type !== 'week').slice(0,4).map(m => <div className="meal-row" key={m.id}><span className="meal-dot"/><div><b>{m.custom_title || 'Mahlzeit'}</b><small>{new Date(m.meal_date+'T12:00:00').toLocaleDateString('de-DE',{weekday:'long'})} · {mealLabel(m.meal_type)}</small></div></div>)}</div> : <div className="empty-state compact"><div className="empty-illustration"><CookingPot size={24}/></div><b>Der Plan ist noch leer.</b><span>Füge eure ersten Gerichte hinzu.</span><button className="button button-dark button-small" onClick={() => setTab('planner')}>Woche planen <span>→</span></button></div>}{weekEntries.length>0&&<div className="week-overview-items"><span className="eyebrow">FÜR DIE GANZE WOCHE</span>{weekEntries.map(m=><div className="cost-line" key={m.id}><div><b>{m.custom_title}</b><small>{formatAmount(m.quantity===null?null:Number(m.quantity),m.unit)}{costLabel(m.id)?' · '+costLabel(m.id):''}</small></div><span className="meal-actions"><button type="button" onClick={()=>deleteMeal(m)} aria-label={(m.custom_title||'Eintrag')+' löschen'}><Trash2 size={13}/></button></span></div>)}</div>}
            </div>
            <div className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">GUT VORBEREITET</span><h2>Einkauf im Blick</h2></div><button className="round-icon" onClick={() => setTab('shopping')}><ListChecks size={18}/></button></div>
              {shopping.length ? <><div className="shopping-progress"><div className="progress"><i style={{width:(shopping.filter(i=>i.checked).length/ shopping.length*100)+'%'}}/></div><small>{shopping.filter(i=>i.checked).length} von {shopping.length} erledigt</small></div>{shopping.filter(i=>!i.checked).slice(0,5).map(i=><div className="mini-item" key={i.id}><button className="check-circle" onClick={()=>toggleShopping(i)} aria-label="Abhaken"/><span>{i.name}</span>{i.quantity && <small>{i.quantity} {i.unit}</small>}</div>)}<button className="button button-light button-full" onClick={()=>setTab('shopping')}>Zur Einkaufsliste</button></> : <div className="empty-state compact"><div className="empty-illustration"><ShoppingBasket size={24}/></div><b>Alles auf Anfang.</b><span>Deine Einkaufsliste wartet auf dich.</span><button className="button button-dark button-small" onClick={()=>setTab('shopping')}>Artikel hinzufügen</button></div>}
            </div>
          </div>
          <div className="tip-banner"><div className="tip-icon"><Sparkles size={20}/></div><div><b>Weniger wegwerfen, mehr rausholen.</b><span>Behalte Mindesthaltbarkeitsdaten im Blick und plane Zutaten mehrfach ein.</span></div><button onClick={()=>setTab('pantry')}>Vorrat ansehen →</button></div>
        </section>}
        {tab === 'planner' && <section><div className="page-heading"><div><div className="eyebrow">GEMEINSAM KOCHEN</div><h1>Wochenplan</h1><p>Ein guter Plan macht den Einkauf leichter.</p></div></div><div className="week-controls"><button className="button button-light" onClick={()=>setWeekStart(mondayISO(new Date(new Date(weekStart+'T12:00:00').getTime()-7*86400000)))}>← Vorherige Woche</button><b>{new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'long'}).format(new Date(weekStart+'T12:00:00'))} – {new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'long',year:'numeric'}).format(days[6])}</b><button className="button button-light" onClick={()=>setWeekStart(mondayISO(new Date(new Date(weekStart+'T12:00:00').getTime()+7*86400000)))}>Nächste Woche →</button></div>
          <datalist id="blankmann-foods">{foods.map(f=><option key={f.id} value={f.name}/>)}</datalist>
          <div className="panel week-budget"><div className="panel-head"><div><span className="eyebrow">BUDGET DIESER WOCHE</span><h2>{euro(budget)} Budget · ≈ {euro(plannedTotal)} verplant</h2><small className="muted">Geschätzter Einkaufswert der geplanten Gerichte und Nahrungsmittel – aus euren Bon-, Referenz- und selbst eingetragenen Preisen.</small></div><CircleDollarSign size={20}/></div>
            <div className="week-budget-figures"><div><small>Budget</small><b>{euro(budget)}</b></div><div><small>Verplant ≈</small><b>{euro(plannedTotal)}</b></div><div><small>{budget-plannedTotal>=0?'Noch frei ≈':'Über Budget ≈'}</small><b className={budget-plannedTotal<0?'over':''}>{euro(Math.abs(budget-plannedTotal))}</b></div></div>
            <div className="progress"><i style={{width:Math.min(100,plannedTotal/Math.max(1,budget)*100)+'%'}}/></div>
            {budgetMissing.length>0&&<div style={{marginTop:12}}><small className="muted">Ohne Preis – noch nicht eingerechnet:</small>{budgetMissing.map(line=><div className="cost-line" key={line.foodId??line.name}><div><b>{line.name}</b><ManualPriceForm householdId={household.id} foodId={line.foodId} foodName={line.name} defaultQuantity={line.quantity} defaultUnit={line.unit} defaultOrganic={priceOptions.preferOrganic} onSaved={refreshData} onError={setError}/></div><strong>Preis fehlt</strong></div>)}</div>}
            {freeMeals>0&&<small className="muted" style={{display:'block',marginTop:8}}>{freeMeals} freie(s) Gericht(e) ohne Rezept – dafür lässt sich kein Preis schätzen.</small>}
          </div>
          <div className="panel week-items"><div className="panel-head"><div><span className="eyebrow">FÜR DIE GANZE WOCHE</span><h2>Einzelne Nahrungsmittel</h2><small className="muted">Z. B. Obst, Snacks oder Getränke ohne festen Tag. Sie kommen auf die Einkaufsliste und zählen zum Budget.</small></div><Apple size={20}/></div>
            {weekEntries.length?weekEntries.map(m=><div className="cost-line" key={m.id}><div><b>{m.custom_title}</b><small>{formatAmount(m.quantity===null?null:Number(m.quantity),m.unit)}</small></div><span style={{display:'flex',gap:10,alignItems:'center'}}><strong>{costLabel(m.id)}</strong><span className="meal-actions"><button type="button" onClick={()=>deleteMeal(m)} aria-label={(m.custom_title||'Eintrag')+' löschen'}><Trash2 size={13}/></button></span></span></div>):<p className="muted">Noch nichts für die ganze Woche eingeplant.</p>}
            <form className="food-add-form" onSubmit={e=>addFoodEntry(e,weekStart,'week')} style={{marginTop:12}}><label>Nahrungsmittel<input name="food" list="blankmann-foods" placeholder="z. B. Bananen" required/></label><label>Menge<input name="quantity" inputMode="decimal" placeholder="1" style={{width:80}}/></label><label>Einheit<input name="unit" placeholder="kg" style={{width:80}}/></label><button className="button button-dark" disabled={busy}><Plus size={16}/> Für die Woche</button></form>
          </div>
          <div className="planner-grid">{days.map(d=>{const iso=localISO(d);return <div className="planner-day" key={d.toISOString()}><div className="planner-day-head"><b>{shortDate(d)}</b><small>{d.getDate()}.{d.getMonth()+1}.</small></div>{(['Frühstück','Mittagessen','Abendessen'] as const).map(type=><div className="meal-slot" key={type}><small>{type}</small>{meals.filter(m=>m.meal_date===iso&&m.meal_type===mealTypeValue(type)).map(m=>{const linkedRecipe=recipes.find(r=>r.id===m.recipe_id);return <div className="planned-meal-wrap" key={m.id}><div className="planned-meal">{m.cooked_at?'✓ ':''}{linkedRecipe?.title || m.custom_title}{m.food_item_id?' · '+formatAmount(m.quantity===null?null:Number(m.quantity),m.unit):''}</div>{costLabel(m.id)&&<span className="meal-cost">{costLabel(m.id)}</span>}<div className="meal-actions">{linkedRecipe&&<button type="button" onClick={()=>openDetails(linkedRecipe.id,m.id)} aria-label="Anleitung und Kosten öffnen"><BookOpen size={13}/></button>}<button type="button" onClick={()=>setEditingMealId(editingMealId===m.id?null:m.id)} aria-label="Eintrag bearbeiten"><Edit3 size={13}/></button><button type="button" onClick={()=>deleteMeal(m)} aria-label="Eintrag löschen"><Trash2 size={13}/></button></div>{editingMealId===m.id&&(m.food_item_id?<form className="meal-edit-form" onSubmit={saveMealEdit}><input type="hidden" name="title" value={m.custom_title||''}/><div className="form-row"><label>Menge<input name="quantity" inputMode="decimal" defaultValue={m.quantity??''}/></label><label>Einheit<input name="unit" defaultValue={m.unit||''}/></label></div><label>Datum<input name="meal_date" type="date" defaultValue={m.meal_date} required/></label><label>Mahlzeit<select name="meal_type" defaultValue={m.meal_type}><option value="breakfast">Frühstück</option><option value="lunch">Mittagessen</option><option value="dinner">Abendessen</option></select></label><div className="meal-edit-actions"><button className="button button-dark" disabled={busy}>Speichern</button><button className="button button-light" type="button" onClick={()=>setEditingMealId(null)}>Abbrechen</button></div></form>:<form className="meal-edit-form" onSubmit={saveMealEdit}><label>Gericht<input name="title" defaultValue={m.custom_title || linkedRecipe?.title || ''}/></label><label>Rezept<select name="recipe_id" defaultValue={m.recipe_id || ''}><option value="">Freies Gericht</option>{recipes.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label><label>Datum<input name="meal_date" type="date" defaultValue={m.meal_date} required/></label><label>Mahlzeit<select name="meal_type" defaultValue={m.meal_type}><option value="breakfast">Frühstück</option><option value="lunch">Mittagessen</option><option value="dinner">Abendessen</option></select></label><label>Portionen<input name="servings" type="number" min="1" defaultValue={m.servings || 2}/></label><div className="meal-edit-actions"><button className="button button-dark" disabled={busy}>Speichern</button><button className="button button-light" type="button" onClick={()=>setEditingMealId(null)}>Abbrechen</button></div></form>)}</div>})}{slotForm===iso+'|'+type?<form className="meal-edit-form" onSubmit={e=>addFoodEntry(e,iso,mealTypeValue(type))}><label>Nahrungsmittel<input name="food" list="blankmann-foods" placeholder="z. B. Apfel" required autoFocus/></label><div className="form-row"><label>Menge<input name="quantity" inputMode="decimal" placeholder="1"/></label><label>Einheit<input name="unit" placeholder="Stk"/></label></div><div className="meal-edit-actions"><button className="button button-dark" disabled={busy}>Hinzufügen</button><button className="button button-light" type="button" onClick={()=>setSlotForm(null)}>Abbrechen</button></div></form>:<button type="button" className="slot-add" onClick={()=>setSlotForm(iso+'|'+type)}>+ Lebensmittel</button>}</div>)}</div>})}</div>
          <form className="panel form-panel" onSubmit={addMeal}><div className="panel-head"><div><span className="eyebrow">NEUES GERICHT</span><h2>Mahlzeit eintragen</h2></div><CookingPot size={22}/></div><div className="form-row"><label>Gericht (frei oder Rezept)<input name="title" placeholder="Freies Gericht – oder Rezept auswählen"/></label><label>Rezept<select name="recipe_id" defaultValue=""><option value="">Kein gespeichertes Rezept</option>{recipes.map(recipe=><option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}</select></label><label>Tag<input name="meal_date" type="date" defaultValue={weekStart} min={weekStart} max={days[6].toISOString().slice(0,10)} required/></label><label>Mahlzeit<select name="meal_type"><option value="dinner">Abendessen</option><option value="lunch">Mittagessen</option><option value="breakfast">Frühstück</option></select></label><label>Portionen<input name="servings" type="number" min="1" step="1" defaultValue="2"/></label><button className="button button-dark" disabled={busy}><Plus size={16}/> Hinzufügen</button></div></form></section>}
        {tab === 'shopping' && <section><div className="page-heading"><div><div className="eyebrow">ZUSAMMEN EINKAUFEN</div><h1>Einkaufsliste</h1><p>Abhaken synchronisiert sich direkt zwischen euren Geräten.</p></div><div className="heading-icon"><ShoppingBasket size={25}/></div></div>
          <div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">WOCHENEINKAUF</span><h2>{visibleShopping.length} Artikel · {openCount} offen</h2><small className="muted">Aus dem Wochenplan (Rezepte und Nahrungsmittel) plus eigene Artikel – gleiche Artikel addiert, euer Vorrat ist abgezogen.</small><small className="shopping-forecast">Prognose Einkauf ≈ {euro(shoppingTotal)}{shoppingMissing?' · '+shoppingMissing+' Artikel ohne Preis':''}</small></div><span className="list-counter">{openCount}</span></div>
            <div className="shopping-view-switch"><button type="button" className={shoppingView==='check'?'selected':''} onClick={()=>setShoppingView('check')}>Abhaken</button><button type="button" className={shoppingView==='edit'?'selected':''} onClick={()=>setShoppingView('edit')}>Bearbeiten</button><button type="button" className={shoppingView==='recipes'?'selected':''} onClick={()=>setShoppingView('recipes')}>Nach Rezepten</button></div>
            {shoppingView==='check' && (visibleShopping.length ? <>
              <div className="shopping-progress"><div className="progress"><i style={{width:(doneCount/Math.max(1,visibleShopping.length)*100)+'%'}}/></div><small>{doneCount} von {visibleShopping.length} erledigt</small></div>
              {Object.entries(visibleShopping.reduce<Record<string,ShoppingGroup[]>>((acc,group)=>{(acc[group.aisle]??=[]).push(group);return acc},{})).map(([aisle,groups])=><div className="shopping-group" key={aisle}><h3>{aisle}</h3>{groups.map(group=><div className={group.checked?'shopping-check-row checked':'shopping-check-row'} key={group.key}><button type="button" className={group.checked?'check-circle checked':'check-circle'} onClick={()=>toggleGroup(group)} aria-label={(group.checked?'Nicht mehr abgehakt: ':'Abhaken: ')+group.name}>{group.checked&&<Check size={13}/>}</button><div className="shopping-total-main" onClick={()=>toggleGroup(group)}><b>{group.name}{isStapleName(group.name)&&<span className="staple-tag">Grundausstattung</span>}</b><small>{amountText(group)}{group.pantry>0?' · '+Number(group.pantry.toFixed(2))+' '+(group.unit||'')+' im Vorrat':''}</small></div>{(()=>{const line=shoppingCost(group);return line?<span className={line.basis==='missing'?'shopping-cost missing':'shopping-cost'}>{shoppingCostText(line)}</span>:null})()}</div>)}</div>)}
              <div className="details-actions">{doneCount>0&&<button type="button" className="button button-light button-small" onClick={deleteCheckedShopping}><Trash2 size={14}/> Abgehakte löschen ({doneCount})</button>}{hiddenCount>0&&<button type="button" className="text-link" onClick={showHiddenShopping}>{hiddenCount} ausgeblendete wieder anzeigen</button>}</div>
            </> : <div className="empty-state"><ShoppingBasket size={30}/><b>Noch kein Einkaufsbedarf.</b><span>Plane Rezepte im Wochenplan oder ergänze unter „Bearbeiten“ eigene Artikel.</span>{hiddenCount>0&&<button type="button" className="text-link" onClick={showHiddenShopping}>{hiddenCount} ausgeblendete wieder anzeigen</button>}</div>)}
            {shoppingView==='edit' && <>
              <form onSubmit={addShoppingItem} className="food-add-form shopping-add-form"><label>Artikel<input name="name" placeholder="z. B. Paprika" required/></label><label>Menge<input name="quantity" type="number" min="0" step="0.1" placeholder="2" style={{width:80}}/></label><label>Einheit<input name="unit" placeholder="Stück" style={{width:80}}/></label><label>Kategorie<select name="aisle"><option>Obst & Gemüse</option><option>Fleisch & Fisch</option><option>Molkerei</option><option>Trockenware</option><option>Tiefkühl</option><option>Haushalt</option><option>Sonstiges</option></select></label><button className="button button-dark"><Plus size={16}/> Hinzufügen</button></form>
              {visibleShopping.length ? visibleShopping.map(group=>{const line=shoppingCost(group);const missingAmount=group.planLines.filter(l=>l.quantityMissing);return <div className="shopping-edit-row" key={group.key}>
                <div className="cost-line"><div><b>{group.name}{isStapleName(group.name)&&<span className="staple-tag">Grundausstattung</span>}</b><small>Bedarf: {group.needed===null?'Menge offen':Number(group.needed.toFixed(2))+' '+(group.unit||'')} · Vorrat: {Number(group.pantry.toFixed(2))} {group.unit||''} · Kaufen: {amountText(group)} · {[group.fromPlan?'aus dem Wochenplan':'',group.manualRows.length?'eigener Artikel':''].filter(Boolean).join(' + ')}</small></div><strong>{line?shoppingCostText(line):'–'}</strong></div>
                {missingAmount.map((l,i)=>l.kind==='recipe'&&l.ingredientId?<form className="food-add-form shopping-fix" key={'r'+i} onSubmit={e=>saveIngredientAmount(e,l.ingredientId!)}><small className="muted">⚠ Menge fehlt im Rezept „{l.recipeTitle}“ (für {String(l.recipeServings).replace('.',',')} Portionen):</small><input name="quantity" inputMode="decimal" placeholder="Menge" style={{width:80}} required/><input name="unit" defaultValue={group.unit||''} placeholder="Einheit" style={{width:80}}/><button className="button button-dark button-small">Speichern</button></form>:l.kind==='food'?<form className="food-add-form shopping-fix" key={'f'+i} onSubmit={e=>saveFoodEntryAmount(e,l.mealId)}><small className="muted">⚠ Menge fehlt im Wochenplan:</small><input name="quantity" inputMode="decimal" placeholder="Menge" style={{width:80}} required/><input name="unit" defaultValue={group.unit||''} placeholder="Einheit" style={{width:80}}/><button className="button button-dark button-small">Speichern</button></form>:null)}
                {line?.basis==='missing'&&<div className="shopping-fix"><small className="muted">⚠ Preis fehlt:</small> <ManualPriceForm householdId={household.id} foodId={line.foodId} foodName={group.name} defaultQuantity={null} defaultUnit={group.unit} defaultOrganic={priceOptions.preferOrganic} onSaved={refreshData} onError={setError}/></div>}
                {group.manualRows.map(row=><form className="food-add-form shopping-fix" key={row.id} onSubmit={e=>saveManualItem(e,row)}><small className="muted">Eigener Artikel:</small><input name="quantity" inputMode="decimal" defaultValue={row.quantity??''} placeholder="Menge" style={{width:80}}/><input name="unit" defaultValue={row.unit||''} placeholder="Einheit" style={{width:80}}/><button className="button button-light button-small">Speichern</button><span className="meal-actions"><button type="button" onClick={()=>deleteShoppingItem(row)} aria-label={row.name+' löschen'}><Trash2 size={13}/></button></span></form>)}
              </div>}) : <div className="empty-state"><ShoppingBasket size={30}/><b>Noch nichts auf der Liste.</b><span>Ergänze oben eigene Artikel oder plane Rezepte im Wochenplan.</span></div>}{showHiddenButton&&<div className="details-actions">{showHiddenButton}</div>}
            </>}
            {shoppingView==='recipes' && (meals.length||shopping.length ? <>{meals.map(meal=>{const recipe=recipes.find(r=>r.id===meal.recipe_id);const allLines=recipeDemand.filter(line=>line.mealId===meal.id);const lines=allLines.filter(line=>!hiddenKeys.has(shoppingKey(line.name,line.unit)));if(allLines.length&&!lines.length)return null;return <div className="recipe-shopping-card" key={meal.id}><div className="recipe-shopping-head"><div><b>{meal.custom_title||recipe?.title||'Freies Gericht'}</b><small>{new Date(meal.meal_date+'T12:00:00').toLocaleDateString('de-DE',{weekday:'long',day:'2-digit',month:'2-digit'})} · {mealLabel(meal.meal_type)} · {meal.servings} Portionen</small></div><span>{recipe?'Rezept':meal.food_item_id?'Einzeln':'Ohne Rezept'}{costLabel(meal.id)?' · '+costLabel(meal.id):''}</span></div>{lines.length?lines.map((line,i)=><div className="recipe-ingredient-line" key={meal.id+'-'+i}><span>{line.name}</span><b>{line.quantity===null?'Menge offen':`${Number(line.quantity.toFixed(2))} ${line.unit||''}`}</b></div>):<p className="muted">{recipe?'Für dieses Rezept sind noch keine Zutaten hinterlegt.':meal.food_item_id?'Menge offen.':'Freies Gericht – keine Zutatenliste vorhanden.'}</p>}</div>})}{shopping.length>0&&<div className="recipe-shopping-card"><div className="recipe-shopping-head"><div><b>Manuell hinzugefügt</b><small>Artikel, die ihr unabhängig von Rezepten ergänzt habt</small></div><span>{shopping.length} Artikel</span></div>{shopping.map(item=><div className="recipe-ingredient-line" key={item.id}><button className={item.checked?'check-circle checked':'check-circle'} onClick={()=>toggleShopping(item)} aria-label="Manuellen Artikel abhaken">{item.checked&&<Check size={13}/>}</button><span>{item.name}</span><b>{item.quantity??'Menge offen'} {item.unit||''}{(()=>{const text=shoppingCostText(estimateCost({name:item.name,food_item_id:null,quantity:item.quantity===null?null:Number(item.quantity),unit:item.unit},foods,foodPrices,priceOptions));return text?' · '+text:''})()}</b></div>)}</div>}{showHiddenButton&&<div className="details-actions">{showHiddenButton}</div>}</> : <div className="empty-state"><BookOpen size={30}/><b>Noch keine Rezepte im Wochenplan.</b><span>Wähle im Wochenplan ein gespeichertes Rezept aus.</span></div>)}
          </div></section>}
        {tab === 'pantry' && <section><div className="page-heading"><div><div className="eyebrow">WENIGER VERSCHWENDEN</div><h1>Dein Vorrat</h1><p>Was da ist, muss nicht noch einmal gekauft werden.</p></div><div className="heading-icon"><Warehouse size={25}/></div></div><div className="shopping-layout"><div className="panel add-panel"><span className="eyebrow">VORRAT ERGÄNZEN</span><h2>Was habt ihr da?</h2><form className="stack-form" onSubmit={addPantryItem}><label>Zutat<input name="name" placeholder="z. B. Kartoffeln" required/></label><div className="form-row"><label>Menge<input name="quantity" type="number" min="0" step="0.1" placeholder="1"/></label><label>Einheit<input name="unit" placeholder="kg"/></label></div><label className="inline-check"><input type="checkbox" name="is_organic"/> Bio <small className="muted">(zählt für Rezepte wie die normale Variante)</small></label><label>Mindesthaltbar bis<input name="best_before" type="date"/></label><label>Lagerort<select name="storage_location"><option>Vorratsschrank</option><option>Kühlschrank</option><option>Gefrierfach</option><option>Keller</option></select></label><button className="button button-dark button-full"><Plus size={16}/> Zum Vorrat</button></form></div><div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">EURE ZUTATEN</span><h2>{pantry.length} Vorratsartikel</h2></div><Search size={19}/></div>{pantry.length?pantry.map(item=><div className="pantry-row" key={item.id}><div className="pantry-icon"><Apple size={18}/></div><div className="pantry-name"><b>{item.name}{item.is_organic&&<span className="bio-tag">Bio</span>}</b><small>{item.storage_location || 'Vorrat'} {item.best_before?'· MHD '+new Date(item.best_before+'T12:00:00').toLocaleDateString('de-DE'):''}</small></div><span>{item.quantity??''} {item.unit??''}</span><div className="meal-actions"><button type="button" onClick={()=>deletePantryItem(item)} aria-label={item.name+' aus dem Vorrat löschen'}><Trash2 size={13}/></button></div></div>):<div className="empty-state"><Warehouse size={30}/><b>Noch ist der Vorrat leer.</b><span>Trage eure Zutaten ein, damit wir sie beim Planen berücksichtigen können.</span></div>}</div></div></section>}
        {tab === 'foods' && <section>
          <div className="page-heading"><div><div className="eyebrow">EURE ZUTATENBASIS</div><h1>Nahrungsmittel</h1><p>{foods.length} Einträge im gemeinsamen Katalog.</p></div><div className="heading-icon"><Apple size={25}/></div></div>
          <div className="shopping-layout">
            <form className="panel add-panel stack-form" onSubmit={addFood}><span className="eyebrow">NEUES NAHRUNGSMITTEL</span><h2>Eintrag anlegen</h2>
              <label>Name<input name="name" placeholder="z. B. Hähnchenbrustfilet" required/></label>
              <label>Kategorie<select name="category">{foodCategories.map(category=><option key={category}>{category}</option>)}</select></label>
              <label>Standardeinheit<input name="default_unit" placeholder="z. B. g, ml, Stück"/></label><label>Notiz<input name="notes" placeholder="Optional"/></label>
              <button className="button button-dark button-full"><Plus size={16}/> Nahrungsmittel speichern</button></form>
            <div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">KATALOG</span><h2>{foods.length} Einträge</h2></div><Apple size={19}/></div>
              <label>Suchen<input value={foodSearch} onChange={e=>setFoodSearch(e.target.value)} placeholder="Nahrungsmittel suchen …"/></label>
              {(()=>{const searching=foodSearch.trim().length>0;const grouped=Object.entries(foods.filter(f=>f.name.toLocaleLowerCase('de-DE').includes(foodSearch.toLocaleLowerCase('de-DE')) || f.category.toLocaleLowerCase('de-DE').includes(foodSearch.toLocaleLowerCase('de-DE'))).reduce<Record<string,FoodItem[]>>((groups,food)=>{ (groups[food.category] ??= []).push(food); return groups },{})).sort(([a],[b])=>{const ia=foodCategories.indexOf(a),ib=foodCategories.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b,'de-DE')});const allClosed=grouped.length>0&&grouped.every(([category])=>collapsedGroups.includes(category));return <>{!searching&&grouped.length>1&&<div className="food-collapse-all"><button type="button" className="text-link" onClick={()=>saveCollapsed(allClosed?[]:grouped.map(([category])=>category))}>{allClosed?'Alle aufklappen':'Alle zuklappen'}</button></div>}{grouped.map(([category,items])=>{const closed=!searching&&collapsedGroups.includes(category);return <div className={closed?'food-category closed':'food-category'} key={category}><h3><button type="button" className="food-category-toggle" aria-expanded={!closed} onClick={()=>saveCollapsed(closed?collapsedGroups.filter(c=>c!==category):[...collapsedGroups,category])}><span className="food-category-chevron"><ChevronDown size={15}/></span>{category} <small>{items.length}</small></button></h3>{!closed&&items.map(food=><div className="food-row" key={food.id}><div className="pantry-icon"><Apple size={16}/></div>{(()=>{const rows=foodPrices.filter(p=>p.food_item_id===food.id);const price=rows[0];return <><div className="pantry-name"><b>{food.name}{food.is_staple&&<span className="staple-tag">Grundausstattung</span>}{food.source_name==='KI'&&<span className="ai-tag" title="Von der KI für ein Rezept angelegt">KI</span>}</b><small>{food.default_unit || 'Einheit bei Bedarf'}{price ? ' · '+retailerName(price.retailer_code)+(price.is_organic?' (Bio)':'')+' · '+new Date(price.observed_at+'T12:00:00').toLocaleDateString('de-DE') : ''}{rows.length>1?' · '+rows.length+' Preise (Tab „Preise“)':''}</small><div className="food-row-actions"><select className="food-group-select" value={food.category} onChange={e=>changeFoodCategory(food,e.target.value)} aria-label={'Gruppe von '+food.name}>{(foodCategories.includes(food.category)?foodCategories:[...foodCategories,food.category]).map(category=><option key={category}>{category}</option>)}</select><button type="button" className="text-link staple-toggle" onClick={()=>toggleStaple(food)}>{food.is_staple?'Keine Grundausstattung':'Als Grundausstattung markieren'}</button></div></div>{price ? <span className="food-price">{euro(Number(price.price_eur))}<small>{price.package_quantity!==null?formatAmount(Number(price.package_quantity),price.package_unit):''}</small></span> : <span className="food-source">Preis folgt per Bon</span>}</>})()}</div>)}</div>})}</>})()}
            </div></div><div className="notice-card"><Sparkles size={18}/><span>Für 58 Nahrungsmittel sind bereits recherchierte Referenzpreise hinterlegt. Sie stammen aus einer Online-Preiserhebung (Juni 2026), können regional abweichen und werden mit euren Einkaufsbons nach und nach durch echte Ladenpreise ergänzt.</span></div>
          </section>}
        {tab === 'recipes' && <section><div className="page-heading"><div><div className="eyebrow">EURE REZEPTSAMMLUNG</div><h1>Rezepte</h1><p>Eure Lieblingsgerichte und Thermomix-Rezepte aus Cookidoo an einem Ort.</p></div><div className="heading-icon"><BookOpen size={25}/></div></div><div className="shopping-layout"><form className="panel add-panel stack-form" onSubmit={addRecipe}><span className="eyebrow">NEUES REZEPT</span><h2>Gericht speichern</h2><label>Name<input name="title" placeholder="z. B. Hähnchen-Gemüse-Pfanne" required/></label><label>Kurzbeschreibung<input name="description" placeholder="Was macht das Gericht besonders?"/></label><div className="form-row"><label>Portionen<input name="servings" type="number" min="1" defaultValue="2"/></label><label>Vorbereitung (Min.)<input name="prep_minutes" type="number" min="0" placeholder="15"/></label></div><label>Kochzeit (Min.)<input name="cook_minutes" type="number" min="0" placeholder="25"/></label><IngredientPicker key={'new-'+newRecipePicker} foods={foods} initial={[]} title="Zutaten aus dem Nahrungsmittel-Katalog" hint="Suchen, Zutaten anhaken und die Menge eintragen. Ohne Menge erscheint später „Menge offen“. Die KI ergänzt nach dem Speichern fehlende Gewürze und Zutaten (markiert mit „KI“)."/><button className="button button-dark button-full" disabled={busy}><Plus size={16}/> Rezept speichern</button></form><div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">EURE SAMMLUNG</span><h2>{recipes.length} Rezepte</h2></div><BookOpen size={19}/></div>{aiProgress?<div className="notice-card"><Sparkles size={18}/><span>{aiProgress}</span></div>:recipes.some(recipeIncomplete)&&<button type="button" className="button button-dark button-small" style={{marginBottom:12}} onClick={()=>completeRecipes(recipes.filter(recipeIncomplete))}><Sparkles size={14}/> {recipes.filter(recipeIncomplete).length} Rezept(e) mit KI ergänzen – Anleitung, Mengen, Kochzeit, Histamin</button>}<div className="recipe-filters"><label>Sortieren<select value={recipeSort} onChange={e=>setRecipeSort(e.target.value as typeof recipeSort)}><option value="standard">Standard (neueste zuerst)</option><option value="histamine-desc">Histamin absteigend (10 → 1, histaminarm zuerst)</option><option value="histamine-asc">Histamin aufsteigend (1 → 10)</option><option value="rating-desc">Eure Bewertung absteigend (beste zuerst)</option><option value="rating-asc">Eure Bewertung aufsteigend</option></select></label></div>{filteredRecipes.length?filteredRecipes.map(recipe=><div className="recipe-card-editable" key={recipe.id}><div className="recipe-row">{recipe.photo_path&&photoUrls[recipe.photo_path]?<img className="recipe-thumb" src={photoUrls[recipe.photo_path]} alt={'Foto von '+recipe.title}/>:<div className="pantry-icon"><CookingPot size={18}/></div>}<div className="pantry-name"><b>{recipe.title}</b><span className="recipe-badges">{isThermomix(recipe)&&<span className="badge thermomix" title="Thermomix-Rezept aus Cookidoo">Thermomix</span>}{recipe.histamine_score?<span className={'badge histamine h'+(recipe.histamine_score>=7?'good':recipe.histamine_score>=4?'mid':'bad')} title={recipe.histamine_note||'KI-Schätzung'}>Histamin {recipe.histamine_score}/10</span>:null}{recipe.rating!=null?<span className="badge rating">★ {String(Number(recipe.rating)).replace('.',',')}/10</span>:null}</span><small>{(isThermomix(recipe)?recipe.description?.replace(/^Thermomix · /,''):recipe.description) || 'Eigenes Rezept'} · {recipe.servings} Portionen · {(recipe.recipe_ingredients||[]).length} Zutaten {(recipe.prep_minutes||recipe.cook_minutes)?' · ⏱ '+((recipe.prep_minutes||0)+(recipe.cook_minutes||0))+' Min':''} · ≈ {euro(estimateRecipeCost(recipe,recipe.servings,foods,foodPrices).total)}{estimateRecipeCost(recipe,recipe.servings,foods,foodPrices).missing.length?' (Preise unvollständig)':''}</small></div><span>{[recipe.prep_minutes,recipe.cook_minutes].filter(Boolean).length?[recipe.prep_minutes,recipe.cook_minutes].filter(Boolean).reduce((a,b)=>Number(a)+Number(b),0)+' Min.':'–'}</span><div className="meal-actions"><button type="button" onClick={()=>openDetails(recipe.id,null)} aria-label="Anleitung und Kosten öffnen"><BookOpen size={14}/></button><button type="button" onClick={()=>setEditingRecipeId(editingRecipeId===recipe.id?null:recipe.id)} aria-label="Rezept bearbeiten"><Edit3 size={14}/></button><button type="button" onClick={()=>deleteRecipe(recipe)} aria-label="Rezept löschen"><Trash2 size={14}/></button></div></div>{editingRecipeId===recipe.id&&<form className="recipe-edit-form" onSubmit={saveRecipeEdit}><label>Name<input name="title" defaultValue={recipe.title} required/></label><label>Kurzbeschreibung<input name="description" defaultValue={recipe.description||''}/></label><div className="form-row"><label>Portionen<input name="servings" type="number" min="1" defaultValue={recipe.servings}/></label><label>Vorbereitung (Min.)<input name="prep_minutes" type="number" min="0" defaultValue={recipe.prep_minutes??''}/></label><label>Kochzeit (Min.)<input name="cook_minutes" type="number" min="0" defaultValue={recipe.cook_minutes??''}/></label></div><div className="form-row"><label>Histamin 1–10<input name="histamine_score" type="number" min="1" max="10" defaultValue={recipe.histamine_score??''}/></label><label>Bewertung 1–10 (z. B. 6,7)<input name="rating" inputMode="decimal" defaultValue={recipe.rating!=null?String(Number(recipe.rating)).replace('.',','):''}/></label></div><div className="recipe-photo-edit">{recipe.photo_path&&photoUrls[recipe.photo_path]&&<img className="recipe-thumb large" src={photoUrls[recipe.photo_path]} alt={'Foto von '+recipe.title}/>}<label>Foto{recipe.photo_path?' ersetzen':' hinzufügen'}<input name="photo" type="file" accept="image/*"/></label>{recipe.photo_path&&<label className="inline-check"><input type="checkbox" name="remove_photo"/> Foto entfernen</label>}</div><IngredientPicker foods={foods} initial={recipe.recipe_ingredients||[]} title="Zutaten und Mengen" hint="Vorhandene Zutaten stehen oben. Häkchen entfernen, um Zutaten zu löschen – auch die von der KI ergänzten (markiert mit „KI“). Weitere Zutaten über die Suche hinzufügen."/><div className="meal-edit-actions"><button className="button button-dark" disabled={busy}>Änderungen speichern</button><button className="button button-light" type="button" onClick={()=>setEditingRecipeId(null)}>Abbrechen</button></div></form>}</div>):<div className="empty-state"><BookOpen size={30}/><b>Noch keine Rezepte gespeichert.</b><span>Füge links euer erstes Lieblingsgericht hinzu.</span></div>}</div></div><div className="preference-chips">{settings?.histamine_low_enabled&&<span><Leaf size={14}/> Histaminbewusst</span>}{settings?.tomato_free_enabled&&<span>Tomatenfrei</span>}{settings?.cream_free_enabled&&<span>Sahnefrei</span>}{settings?.vegetable_rich_enabled&&<span>Gemüsereich</span>}</div><div className="notice-card"><Sparkles size={18}/><span>Thermomix-Rezepte: Zutaten und Mengen stammen aus Cookidoo und bleiben unverändert – die KI ergänzt nur und schreibt die Anleitung für Herd und Ofen. Die Original-Zubereitung öffnet „In Cookidoo öffnen“ im Rezept.</span></div></section>}
        {tab === 'receipts' && <ReceiptScanner householdId={household.id} userId={session.user.id} onDone={refreshData} />}
        {tab === 'prices' && <section><div className="page-heading"><div><div className="eyebrow">CLEVER VERGLEICHEN</div><h1>Supermarktpreise</h1><p>Preise je Supermarkt – für Einkaufsliste, Budget und späteren Preisvergleich.</p></div><div className="heading-icon"><Store size={25}/></div></div><div className="retailer-grid">{retailerCards.map(([code,name])=>{const rows=foodPrices.filter(p=>p.retailer_code===code);const fromReceipts=rows.filter(p=>p.source_name.startsWith('Kassenbon')).length;return <div className="retailer-card" key={code}><div className="retailer-logo">{name.slice(0,1)}</div><b>{name}</b><span>{rows.length} Preise</span><small>{rows.length?(fromReceipts?fromReceipts+' vom Kassenbon':'Referenzpreise'):'Noch keine Preise'}</small></div>})}</div><div className="panel price-catalog-panel"><div className="panel-head"><div><span className="eyebrow">EURE PREISE</span><h2>{foodPrices.length} Preise für {new Set(foodPrices.map(p=>p.food_item_id)).size} Nahrungsmittel</h2><small className="muted">Je Nahrungsmittel ein Preis pro Supermarkt, Bio und normal getrennt. Ein neuer Bon oder Preis desselben Markts ersetzt den alten. Einkaufsliste und Budget rechnen mit dem Mittelwert über die Märkte{priceOptions.preferOrganic?' (Bio bevorzugt)':''}.</small></div><CircleDollarSign size={20}/></div>{foods.filter(food=>foodPrices.some(p=>p.food_item_id===food.id)).map(food=>{const rows=foodPrices.filter(p=>p.food_item_id===food.id).sort((a,b)=>Number(Boolean(a.is_organic))-Number(Boolean(b.is_organic))||retailerName(a.retailer_code).localeCompare(retailerName(b.retailer_code),'de-DE'));return <div className="price-food" key={food.id}><b className="price-food-name">{food.name}{rows.length>1&&<small> · {rows.length} Preise</small>}</b>{rows.map(price=>{const quantity=price.package_quantity===null?null:Number(price.package_quantity);return <div className="price-catalog-row" key={price.id}><div className="pantry-name"><b>{retailerName(price.retailer_code)}{price.is_organic&&<span className="bio-tag">Bio</span>}</b><small>{price.source_name} · {new Date(price.observed_at+'T12:00:00').toLocaleDateString('de-DE')}</small>{canSplitToOne(quantity,price.package_unit)&&<button type="button" className="text-link" onClick={()=>splitExistingPrice(price,food.name)}>Auf 1 {price.package_unit||'Stk'} runterrechnen (= {euro(splitToOne(Number(price.price_eur),quantity!,price.package_unit).price)})</button>}</div><div className="price-catalog-value"><b>{euro(Number(price.price_eur))}</b><small>{quantity!==null?formatAmount(quantity,price.package_unit):''}</small></div></div>})}</div>})}</div><div className="notice-card"><Store size={19}/><span>Online recherchierte Referenzpreise können je nach Filiale, Marke, Packungsgröße und Aktionswoche abweichen. Ein Kassenbon ersetzt den Referenzpreis desselben Markts durch den echten Ladenpreis. „Bio“ wird bei allen Produkten erkannt und als eigener Preis desselben Nahrungsmittels gespeichert. Nicht belegte Preise bleiben leer – wir schätzen sie nicht einfach.</span></div></section>}
        {tab === 'settings' && <section><div className="page-heading"><div><div className="eyebrow">EURE HAUSHALTSREGELN</div><h1>Einstellungen</h1><p>So soll BLANKMANN für euch planen.</p></div><div className="heading-icon"><Settings2 size={25}/></div></div><div className="panel settings-panel settings-display"><div className="setting-block"><span className="eyebrow">DARSTELLUNG</span><h2>Design und Ansicht</h2><small className="muted">Gilt für dieses Gerät und wird sofort übernommen.</small><div className="settings-display-row"><b>Design</b><div className="theme-switch" role="group" aria-label="Design wählen"><button type="button" className={visualTheme === 'nick' ? 'theme-choice selected' : 'theme-choice'} onClick={() => setVisualTheme('nick')}>Nick</button><button type="button" className={visualTheme === 'sophia' ? 'theme-choice selected' : 'theme-choice'} onClick={() => setVisualTheme('sophia')}>Sophia</button></div></div><div className="settings-display-row"><b>Ansicht</b><div className="device-switch" role="group" aria-label="Ansicht wählen"><button type="button" className={deviceMode === 'phone' ? 'device-choice selected' : 'device-choice'} aria-label="Handy-Ansicht" title="Handy-Ansicht" onClick={() => setDeviceMode('phone')}><Smartphone size={16}/><span>Handy</span></button><button type="button" className={deviceMode === 'tablet' ? 'device-choice selected' : 'device-choice'} aria-label="Tablet-Ansicht" title="Tablet-Ansicht" onClick={() => setDeviceMode('tablet')}><Tablet size={16}/><span>Tablet</span></button><button type="button" className={deviceMode === 'auto' ? 'device-choice selected auto-choice' : 'device-choice auto-choice'} aria-label="Automatische Ansicht" title="Automatisch" onClick={() => setDeviceMode('auto')}>Auto</button></div></div></div></div><form className="panel settings-panel" onSubmit={saveSettings}><div className="setting-block"><span className="eyebrow">BUDGET</span><h2>Wöchentliches Einkaufsbudget</h2><label className="budget-input"><span>€</span><input name="weekly_budget" type="number" min="1" step="1" defaultValue={budget}/></label></div><div className="setting-block"><span className="eyebrow">ESSENSVORLIEBEN</span><h2>Was sollen wir berücksichtigen?</h2><Toggle name="histamine_low_enabled" label="Histaminbewusst planen" description="Möglichst histaminarme Zutaten bevorzugen." checked={settings?.histamine_low_enabled??true}/><Toggle name="tomato_free_enabled" label="Tomatenfrei" description="Auch versteckte Tomatenzutaten in Saucen und Fertigprodukten meiden." checked={settings?.tomato_free_enabled??true}/><Toggle name="cream_free_enabled" label="Ohne Sahne" description="Gerichte standardmäßig ohne Sahne planen." checked={settings?.cream_free_enabled??true}/><Toggle name="vegetable_rich_enabled" label="Gemüsereich" description="Gemüse soll einen großen Teil der Mahlzeiten ausmachen." checked={settings?.vegetable_rich_enabled??true}/></div><div className="setting-block"><span className="eyebrow">PREISE</span><h2>Bio oder normal?</h2><Toggle name="prefer_organic" label="Bio bevorzugen" description="Einkaufsliste, Budget und Rezeptkosten rechnen mit Bio-Preisen (Mittelwert der Supermärkte). Fehlt ein Bio-Preis, zählt der normale – und umgekehrt." checked={settings?.prefer_organic??false}/></div><div className="setting-block"><label>Weitere Hinweise<textarea name="dietary_notes" defaultValue={settings?.dietary_notes??''} placeholder="Weitere Zutaten, die ihr meidet, Vorlieben, Hinweise …"/></label></div><button className="button button-dark">Einstellungen speichern</button></form></section>}
      </div>
      <footer className="footer"><span>BLANKMANN <i>·</i> Fütterungszeiten werden eingehalten</span></footer>
    </main>
  </div>
}

function Stat({icon:Icon,label,value,sub,warn=false}:{icon:typeof Sprout;label:string;value:string;sub:string;warn?:boolean}) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><Icon size={18}/></div><strong>{value}</strong><small className={warn?'over':undefined}>{sub}</small></div>
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
  const hasUrl = Boolean(import.meta.env.VITE_SUPABASE_URL)
  const hasKey = Boolean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  return <div className="loading-screen"><div className="brand-mark">B.</div><h1>BLANKMANN</h1><p>Die Verbindung zur Datenbank fehlt noch.</p><div className="setup-instructions">Build-Diagnose (es werden keine Schlüssel angezeigt):<br /><code>VITE_SUPABASE_URL</code>: {hasUrl ? 'vorhanden' : 'FEHLT'}<br /><code>VITE_SUPABASE_PUBLISHABLE_KEY</code>: {hasKey ? 'vorhanden' : 'FEHLT'}<br /><br />Wenn eine Variable fehlt, kommt sie nicht im Vite-Build an. Bitte die Build-Variablen im richtigen Cloudflare-Worker-Projekt prüfen und anschließend neu deployen.</div></div>
}
