import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
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
import { estimateCost, estimateRecipeCost, formatAmount, type CostLine } from './lib/kitchen'

type Tab = 'overview' | 'planner' | 'shopping' | 'pantry' | 'foods' | 'recipes' | 'prices' | 'receipts' | 'settings'
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
type PantryItem = { id: string; name: string; quantity: number | null; unit: string | null; best_before: string | null; storage_location: string | null; food_item_id: string | null }
type FoodItem = { id: string; name: string; normalized_name: string; category: string; default_unit: string | null; notes: string | null; source_name: string }
type FoodPrice = { id: string; food_item_id: string; retailer_code: string; price_eur: number; package_quantity: number | null; package_unit: string | null; unit_price_eur: number | null; unit_label: string | null; price_type: string; source_name: string; source_url: string | null; observed_at: string }
type Meal = { id: string; meal_date: string; meal_type: string; custom_title: string | null; recipe_id: string | null; servings: number; food_item_id: string | null; quantity: number | null; unit: string | null; cooked_at: string | null }
type RecipeIngredient = { id: string; food_item_id: string | null; name: string; quantity: number | null; unit: string | null; aisle: string | null; is_optional: boolean }
type Recipe = { id: string; title: string; description: string | null; servings: number; prep_minutes: number | null; cook_minutes: number | null; notes: string | null; instructions?: unknown; recipe_ingredients?: RecipeIngredient[] }


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
const mealLabel = (type: string) => (({ breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', week: 'Ganze Woche' } as Record<string, string>)[type] ?? type)
const mealTypeValue = (label: string) => (({ Frühstück: 'breakfast', Mittagessen: 'lunch', Abendessen: 'dinner' } as Record<string, string>)[label] ?? 'dinner')

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [household, setHousehold] = useState<Household | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shopping, setShopping] = useState<ShoppingItem[]>([])
  const [shoppingView, setShoppingView] = useState<'total' | 'recipes'>('total')
  const [pantry, setPantry] = useState<PantryItem[]>([])
  const [foods, setFoods] = useState<FoodItem[]>([])
  const [foodPrices, setFoodPrices] = useState<FoodPrice[]>([])
  const [foodSearch, setFoodSearch] = useState('')
  const [meals, setMeals] = useState<Meal[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [editingMealId, setEditingMealId] = useState<string | null>(null)
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null)
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
    const [shop, stock, plan, recipeRows, foodRows, priceRows] = await Promise.all([
      supabase.from('shopping_list_items').select('*').eq('shopping_list_id', activeList.id).order('created_at'),
      supabase.from('pantry_items').select('*').eq('household_id', household.id).order('best_before', { ascending: true, nullsFirst: false }),
      supabase.from('weekly_plans').select('id').eq('household_id', household.id).eq('week_start', weekStart).maybeSingle(),
      supabase.from('recipes').select('id,title,description,servings,prep_minutes,cook_minutes,notes,instructions,recipe_ingredients(id,food_item_id,name,quantity,unit,aisle,is_optional)').eq('household_id', household.id).order('created_at', { ascending: false }),
      supabase.from('household_foods').select('id,name,normalized_name,category,default_unit,notes,source_name').eq('household_id', household.id).order('category').order('name'),
      supabase.from('household_food_prices').select('id,food_item_id,retailer_code,price_eur,package_quantity,package_unit,unit_price_eur,unit_label,price_type,source_name,source_url,observed_at').eq('household_id', household.id).order('observed_at', { ascending: false }),
    ])
    if (shop.error) throw shop.error
    if (stock.error) throw stock.error
    if (plan.error) throw plan.error
    if (recipeRows.error) throw recipeRows.error
    if (foodRows.error) throw foodRows.error
    if (priceRows.error) throw priceRows.error
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
      .subscribe()
    return () => { client.removeChannel(channel) }
  }, [household, refreshData])

  const remaining = useMemo(() => shopping.filter(i => !i.checked).length, [shopping])
  const spent = useMemo(() => shopping.reduce((sum, i) => sum + Number(i.actual_price ?? 0), 0), [shopping])
  const budget = Number(settings?.weekly_budget ?? 100)

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

  async function deleteCheckedShopping() {
    if (!supabase || !household) return
    const checked = shopping.filter(item => item.checked)
    if (!checked.length) return
    const label = checked.length === 1 ? 'das Element „' + checked[0].name + '“' : 'die ' + checked.length + ' abgehakten Elemente'
    if (!window.confirm('Sicher, dass du ' + label + ' von der Einkaufsliste löschen willst?')) return
    const { error: deleteError } = await supabase.from('shopping_list_items').delete().in('id', checked.map(item => item.id)).eq('household_id', household.id)
    if (deleteError) setError(deleteError.message); else { setNotice(checked.length + ' abgehakte Artikel gelöscht.'); await refreshData() }
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
    const { error: recipeError } = await supabase.from('recipes').update({ title, description: String(form.get('description') || '') || null, servings: Number(form.get('servings') || 2), prep_minutes: form.get('prep_minutes') ? Number(form.get('prep_minutes')) : null, cook_minutes: form.get('cook_minutes') ? Number(form.get('cook_minutes')) : null }).eq('id', recipe.id).eq('household_id', household.id)
    if (recipeError) { setBusy(false); setError(recipeError.message); return }
    const oldIngredients = recipe.recipe_ingredients ?? []
    const rows = foods.filter(food => foodIds.includes(food.id)).map(food => {
      const existing = oldIngredients.find(item => item.food_item_id === food.id)
      const rawQuantity = String(form.get('quantity_' + food.id) || '').trim()
      const unit = String(form.get('unit_' + food.id) || food.default_unit || '').trim()
      return { ...(existing ? { id: existing.id } : {}), household_id: household.id, recipe_id: recipe.id, food_item_id: food.id, name: food.name, normalized_name: food.normalized_name, quantity: rawQuantity && Number.isFinite(Number(rawQuantity)) ? Number(rawQuantity) : null, unit: unit || null, aisle: food.category, is_optional: false, source_text: food.name }
    })
    const savedIngredients = await supabase.from('recipe_ingredients').upsert(rows)
    if (savedIngredients.error) { setBusy(false); setError('Rezeptdaten gespeichert, Zutaten konnten aber nicht aktualisiert werden: ' + savedIngredients.error.message); await refreshData(); return }
    const removedIds = oldIngredients.filter(item => !foodIds.includes(item.food_item_id || '')).map(item => item.id)
    if (removedIds.length) {
      const removed = await supabase.from('recipe_ingredients').delete().in('id', removedIds).eq('household_id', household.id)
      if (removed.error) { setBusy(false); setError('Rezept gespeichert, aber entfernte Zutaten konnten nicht bereinigt werden: ' + removed.error.message); await refreshData(); return }
    }
    setBusy(false); setEditingRecipeId(null); setNotice('Rezept und Zutaten wurden aktualisiert.'); await refreshData()
  }

  async function addFood(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase || !household) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const name = String(form.get('name') || '').trim()
    if (!name) return
    const result = await supabase.from('household_foods').insert({ household_id: household.id, name, normalized_name: name.toLocaleLowerCase('de-DE'), category: String(form.get('category') || 'Sonstiges'), default_unit: String(form.get('default_unit') || '') || null, notes: String(form.get('notes') || '') || null, source_name: 'Manuell', created_by: session?.user.id })
    if (result.error) { setError(result.error.message); return }
    formElement.reset(); setNotice(name + ' wurde hinzugefügt.'); await refreshData()
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
  const recipeDemand = meals.flatMap(meal => {
    if (meal.food_item_id) {
      const food = foods.find(f => f.id === meal.food_item_id)
      const name = food?.name || meal.custom_title || ''
      return [{ mealId: meal.id, mealTitle: name, recipeTitle: 'Einzeln', name, quantity: meal.quantity === null ? null : Number(meal.quantity), unit: meal.unit, aisle: food?.category || 'Sonstiges', normalized: name.toLocaleLowerCase('de-DE').trim() }]
    }
    if (!meal.recipe_id) return []
    const recipe = recipes.find(r => r.id === meal.recipe_id)
    if (!recipe) return []
    return (recipe.recipe_ingredients ?? []).filter(ingredient => !ingredient.is_optional).map(ingredient => ({
      mealId: meal.id, mealTitle: recipe.title, recipeTitle: recipe.title, name: ingredient.name,
      quantity: ingredient.quantity === null ? null : Number(ingredient.quantity) * Number(meal.servings || recipe.servings) / Math.max(1, Number(recipe.servings || 1)),
      unit: ingredient.unit, aisle: ingredient.aisle || 'Sonstiges', normalized: (ingredient.name || '').toLocaleLowerCase('de-DE').trim(),
    }))
  })
  const shoppingTotals = (() => {
    const groups = new Map<string, { name: string; unit: string | null; aisle: string; needed: number | null; pantry: number; checked: boolean; manual: boolean }>()
    const add = (name: string, quantity: number | null, unit: string | null, aisle: string, checked: boolean, manual: boolean) => {
      const normalized = name.toLocaleLowerCase('de-DE').trim()
      const key = normalized + '|' + (unit || '').toLocaleLowerCase('de-DE').trim()
      const current = groups.get(key) ?? { name, unit, aisle, needed: 0, pantry: 0, checked: true, manual: false }
      current.needed = current.needed === null || quantity === null ? null : current.needed + quantity
      current.checked = current.checked && checked
      current.manual = current.manual || manual
      groups.set(key, current)
    }
    recipeDemand.forEach(line => add(line.name, line.quantity, line.unit, line.aisle, false, false))
    shopping.forEach(item => add(item.name, item.quantity === null ? null : Number(item.quantity), item.unit, item.aisle || 'Sonstiges', item.checked, true))
    for (const item of groups.values()) {
      const matches = pantry.filter(p => (p.name || '').toLocaleLowerCase('de-DE').trim() === item.name.toLocaleLowerCase('de-DE').trim() && (p.unit || '').toLocaleLowerCase('de-DE').trim() === (item.unit || '').toLocaleLowerCase('de-DE').trim())
      item.pantry = matches.reduce((sum, p) => sum + Number(p.quantity || 0), 0)
    }
    return Array.from(groups.values()).map(item => ({ ...item, toBuy: item.needed === null ? null : Math.max(0, item.needed - item.pantry) }))
      .filter(item => item.needed === null || (item.toBuy ?? 0) > 0 || item.manual)
      .sort((a,b) => a.aisle.localeCompare(b.aisle, 'de-DE') || a.name.localeCompare(b.name, 'de-DE'))
  })()

  // Geschätzter Einkaufswert je geplantem Eintrag und Budget der Woche.
  const mealCosts = new Map<string, { cost: number | null; missing: CostLine[] }>()
  for (const meal of meals) {
    if (meal.food_item_id) {
      const line = estimateCost({ name: meal.custom_title || '', food_item_id: meal.food_item_id, quantity: meal.quantity === null ? null : Number(meal.quantity), unit: meal.unit }, foods, foodPrices)
      mealCosts.set(meal.id, { cost: line.cost, missing: line.basis === 'missing' ? [line] : [] })
    } else if (meal.recipe_id) {
      const recipe = recipes.find(r => r.id === meal.recipe_id)
      if (recipe) { const cost = estimateRecipeCost(recipe, meal.servings, foods, foodPrices); mealCosts.set(meal.id, { cost: cost.total, missing: cost.missing }) }
    }
  }
  const plannedTotal = Math.round([...mealCosts.values()].reduce((sum, c) => sum + (c.cost ?? 0), 0) * 100) / 100
  const budgetMissing = [...new Map([...mealCosts.values()].flatMap(c => c.missing).map(line => [line.foodId ?? line.name, line])).values()]
  const freeMeals = meals.filter(m => !m.recipe_id && !m.food_item_id).length
  const weekEntries = meals.filter(m => m.meal_type === 'week')
  const costLabel = (id: string) => { const c = mealCosts.get(id); return !c ? '' : c.cost === null ? 'Preis fehlt' : '≈ ' + euro(c.cost) + (c.missing.length ? ' · ' + c.missing.length + ' Preis fehlt' : '') }

  return <div className={"app-shell theme-" + visualTheme + (deviceMode === "tablet" ? " device-tablet" : deviceMode === "phone" ? " device-phone" : "")}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">B.</div><div><strong>BLANKMANN</strong><span>FOODPLANNER</span></div></div>
      <div className="household-chip"><span className="online-dot" />{household.name}<ChevronDown size={14} /></div>
      <nav>{nav.map(item => <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { setTab(item.id); setError(''); setNotice(''); setDetails(null) }}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.id === 'shopping' && remaining > 0 && <small>{remaining}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="budget-mini"><div className="budget-mini-top"><span>Wochenbudget</span><strong>{euro(budget)}</strong></div><div className="progress"><i style={{ width: Math.min(100, spent / Math.max(1, budget) * 100) + '%' }} /></div><small>{euro(spent)} erfasst</small></div><button className="profile-button" onClick={signOut}><div className="avatar">{(session.user.email?.[0] ?? 'B').toUpperCase()}</div><span><b>Mein Konto</b><small>Abmelden</small></span><LogOut size={16} /></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="topbar-left"><div className="build-meta"><b>BUILD 19.11.26-AO</b><span>VERSION 0.3.29</span></div><div className="breadcrumb">Dein Zuhause <span>/</span> {nav.find(n => n.id === tab)?.label}</div></div><div className="mobile-brand"><div className="brand-mark">B.</div><div className="mobile-brand-copy"><strong>BLANKMANN</strong><small>BUILD 19.11.26-AO</small><small>VERSION 0.3.29</small></div></div><div className="topbar-right"><span className="sync-status"><i /> Gemeinsam synchronisiert</span><div className="theme-switch" role="group" aria-label="Design wählen"><button type="button" className={visualTheme === 'nick' ? 'theme-choice selected' : 'theme-choice'} onClick={() => setVisualTheme('nick')}>Nick</button><button type="button" className={visualTheme === 'sophia' ? 'theme-choice selected' : 'theme-choice'} onClick={() => setVisualTheme('sophia')}>Sophia</button></div><div className="device-switch" role="group" aria-label="Ansicht wählen"><button type="button" className={deviceMode === 'phone' ? 'device-choice selected' : 'device-choice'} aria-label="Handy-Ansicht" title="Handy-Ansicht" onClick={() => setDeviceMode('phone')}><Smartphone size={16}/><span>Handy</span></button><button type="button" className={deviceMode === 'tablet' ? 'device-choice selected' : 'device-choice'} aria-label="Tablet-Ansicht" title="Tablet-Ansicht" onClick={() => setDeviceMode('tablet')}><Tablet size={16}/><span>Tablet</span></button><button type="button" className={deviceMode === 'auto' ? 'device-choice selected auto-choice' : 'device-choice auto-choice'} aria-label="Automatische Ansicht" title="Automatisch" onClick={() => setDeviceMode('auto')}>Auto</button></div><button className="icon-button" aria-label="Einstellungen" onClick={() => setTab('settings')}><Settings2 size={19} /></button></div></header>
      <div className="page-wrap">
        {error && <div className="alert error"><span>{error}</span><button onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && <div className="alert success"><Check size={16}/>{notice}</div>}
        {details && (() => {
          const recipe = recipes.find(r => r.id === details.recipeId)
          const meal = details.mealId ? meals.find(m => m.id === details.mealId) ?? null : null
          return recipe ? <RecipeDetails key={recipe.id + (meal?.id ?? '')} recipe={recipe} meal={meal ? { id: meal.id, servings: meal.servings, cooked_at: meal.cooked_at, meal_date: meal.meal_date } : null} foods={foods} prices={foodPrices} pantry={pantry} householdId={household.id} accessToken={session.access_token} onChanged={refreshData} onClose={() => setDetails(null)} onNotice={setNotice} onError={setError} /> : null
        })()}
        {tab === 'overview' && <section>
          <div className="page-heading"><div><div className="eyebrow">DIENSTAG · DEIN WOCHENSTART</div><h1>Was gibt’s diese Woche?</h1><p>Gemeinsam planen, entspannt einkaufen und nichts verschwenden.</p></div><div className="heading-icon"><Sprout size={25}/></div></div>
          <div className="stat-grid">
            <Stat icon={CircleDollarSign} label="Wochenbudget" value={euro(budget)} sub={euro(Math.max(0,budget-spent))+' noch übrig'} />
            <Stat icon={ShoppingBasket} label="Noch einzukaufen" value={String(remaining)} sub="Artikel auf deiner Liste" />
            <Stat icon={Warehouse} label="Im Vorrat" value={String(pantry.length)} sub="gespeicherte Zutaten" />
            <Stat icon={CookingPot} label="Geplante Mahlzeiten" value={String(meals.filter(m => !m.food_item_id).length)} sub="für diese Woche" />
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
        {tab === 'planner' && <section><div className="page-heading"><div><div className="eyebrow">GEMEINSAM KOCHEN</div><h1>Wochenplan</h1><p>Ein guter Plan macht den Einkauf leichter.</p></div></div><div className="week-controls"><button className="button button-light" onClick={()=>setWeekStart(mondayISO(new Date(new Date(weekStart+'T12:00:00').getTime()-7*86400000)))}>← Vorherige Woche</button><b>{new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'long'}).format(new Date(weekStart+'T12:00:00'))} – {new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'long',year:'numeric'}).format(days[6])}</b><button className="button button-light" onClick={()=>setWeekStart(mondayISO(new Date(new Date(weekStart+'T12:00:00').getTime()+7*86400000)))}>Nächste Woche →</button></div>
          <datalist id="blankmann-foods">{foods.map(f=><option key={f.id} value={f.name}/>)}</datalist>
          <div className="panel week-budget"><div className="panel-head"><div><span className="eyebrow">BUDGET DIESER WOCHE</span><h2>{euro(budget)} Budget · ≈ {euro(plannedTotal)} verplant</h2><small className="muted">Geschätzter Einkaufswert der geplanten Gerichte und Nahrungsmittel – aus euren Bon-, Referenz- und selbst eingetragenen Preisen.</small></div><CircleDollarSign size={20}/></div>
            <div className="week-budget-figures"><div><small>Budget</small><b>{euro(budget)}</b></div><div><small>Verplant ≈</small><b>{euro(plannedTotal)}</b></div><div><small>{budget-plannedTotal>=0?'Noch frei ≈':'Über Budget ≈'}</small><b className={budget-plannedTotal<0?'over':''}>{euro(Math.abs(budget-plannedTotal))}</b></div></div>
            <div className="progress"><i style={{width:Math.min(100,plannedTotal/Math.max(1,budget)*100)+'%'}}/></div>
            {budgetMissing.length>0&&<div style={{marginTop:12}}><small className="muted">Ohne Preis – noch nicht eingerechnet:</small>{budgetMissing.map(line=><div className="cost-line" key={line.foodId??line.name}><div><b>{line.name}</b><ManualPriceForm householdId={household.id} foodId={line.foodId} foodName={line.name} defaultQuantity={line.quantity} defaultUnit={line.unit} onSaved={refreshData} onError={setError}/></div><strong>Preis fehlt</strong></div>)}</div>}
            {freeMeals>0&&<small className="muted" style={{display:'block',marginTop:8}}>{freeMeals} freie(s) Gericht(e) ohne Rezept – dafür lässt sich kein Preis schätzen.</small>}
          </div>
          <div className="planner-grid">{days.map(d=>{const iso=d.toISOString().slice(0,10);return <div className="planner-day" key={d.toISOString()}><div className="planner-day-head"><b>{shortDate(d)}</b><small>{d.getDate()}.{d.getMonth()+1}.</small></div>{(['Frühstück','Mittagessen','Abendessen'] as const).map(type=><div className="meal-slot" key={type}><small>{type}</small>{meals.filter(m=>m.meal_date===iso&&m.meal_type===mealTypeValue(type)).map(m=>{const linkedRecipe=recipes.find(r=>r.id===m.recipe_id);return <div className="planned-meal-wrap" key={m.id}><div className="planned-meal">{m.cooked_at?'✓ ':''}{linkedRecipe?.title || m.custom_title}{m.food_item_id?' · '+formatAmount(m.quantity===null?null:Number(m.quantity),m.unit):''}</div>{costLabel(m.id)&&<span className="meal-cost">{costLabel(m.id)}</span>}<div className="meal-actions">{linkedRecipe&&<button type="button" onClick={()=>openDetails(linkedRecipe.id,m.id)} aria-label="Anleitung und Kosten öffnen"><BookOpen size={13}/></button>}<button type="button" onClick={()=>setEditingMealId(editingMealId===m.id?null:m.id)} aria-label="Eintrag bearbeiten"><Edit3 size={13}/></button><button type="button" onClick={()=>deleteMeal(m)} aria-label="Eintrag löschen"><Trash2 size={13}/></button></div>{editingMealId===m.id&&(m.food_item_id?<form className="meal-edit-form" onSubmit={saveMealEdit}><input type="hidden" name="title" value={m.custom_title||''}/><div className="form-row"><label>Menge<input name="quantity" inputMode="decimal" defaultValue={m.quantity??''}/></label><label>Einheit<input name="unit" defaultValue={m.unit||''}/></label></div><label>Datum<input name="meal_date" type="date" defaultValue={m.meal_date} required/></label><label>Mahlzeit<select name="meal_type" defaultValue={m.meal_type}><option value="breakfast">Frühstück</option><option value="lunch">Mittagessen</option><option value="dinner">Abendessen</option></select></label><div className="meal-edit-actions"><button className="button button-dark" disabled={busy}>Speichern</button><button className="button button-light" type="button" onClick={()=>setEditingMealId(null)}>Abbrechen</button></div></form>:<form className="meal-edit-form" onSubmit={saveMealEdit}><label>Gericht<input name="title" defaultValue={m.custom_title || linkedRecipe?.title || ''}/></label><label>Rezept<select name="recipe_id" defaultValue={m.recipe_id || ''}><option value="">Freies Gericht</option>{recipes.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label><label>Datum<input name="meal_date" type="date" defaultValue={m.meal_date} required/></label><label>Mahlzeit<select name="meal_type" defaultValue={m.meal_type}><option value="breakfast">Frühstück</option><option value="lunch">Mittagessen</option><option value="dinner">Abendessen</option></select></label><label>Portionen<input name="servings" type="number" min="1" defaultValue={m.servings || 2}/></label><div className="meal-edit-actions"><button className="button button-dark" disabled={busy}>Speichern</button><button className="button button-light" type="button" onClick={()=>setEditingMealId(null)}>Abbrechen</button></div></form>)}</div>})}{slotForm===iso+'|'+type?<form className="meal-edit-form" onSubmit={e=>addFoodEntry(e,iso,mealTypeValue(type))}><label>Nahrungsmittel<input name="food" list="blankmann-foods" placeholder="z. B. Apfel" required autoFocus/></label><div className="form-row"><label>Menge<input name="quantity" inputMode="decimal" placeholder="1"/></label><label>Einheit<input name="unit" placeholder="Stk"/></label></div><div className="meal-edit-actions"><button className="button button-dark" disabled={busy}>Hinzufügen</button><button className="button button-light" type="button" onClick={()=>setSlotForm(null)}>Abbrechen</button></div></form>:<button type="button" className="slot-add" onClick={()=>setSlotForm(iso+'|'+type)}>+ Lebensmittel</button>}</div>)}</div>})}</div>
          <div className="panel week-items"><div className="panel-head"><div><span className="eyebrow">FÜR DIE GANZE WOCHE</span><h2>Einzelne Nahrungsmittel</h2><small className="muted">Z. B. Obst, Snacks oder Getränke ohne festen Tag. Sie kommen auf die Einkaufsliste und zählen zum Budget.</small></div><Apple size={20}/></div>
            {weekEntries.length?weekEntries.map(m=><div className="cost-line" key={m.id}><div><b>{m.custom_title}</b><small>{formatAmount(m.quantity===null?null:Number(m.quantity),m.unit)}</small></div><span style={{display:'flex',gap:10,alignItems:'center'}}><strong>{costLabel(m.id)}</strong><button type="button" className="text-link" onClick={()=>deleteMeal(m)}>Entfernen</button></span></div>):<p className="muted">Noch nichts für die ganze Woche eingeplant.</p>}
            <form className="food-add-form" onSubmit={e=>addFoodEntry(e,weekStart,'week')} style={{marginTop:12}}><label>Nahrungsmittel<input name="food" list="blankmann-foods" placeholder="z. B. Bananen" required/></label><label>Menge<input name="quantity" inputMode="decimal" placeholder="1" style={{width:80}}/></label><label>Einheit<input name="unit" placeholder="kg" style={{width:80}}/></label><button className="button button-dark" disabled={busy}><Plus size={16}/> Für die Woche</button></form>
          </div>
          <form className="panel form-panel" onSubmit={addMeal}><div className="panel-head"><div><span className="eyebrow">NEUES GERICHT</span><h2>Mahlzeit eintragen</h2></div><CookingPot size={22}/></div><div className="form-row"><label>Gericht (frei oder Rezept)<input name="title" placeholder="Freies Gericht – oder Rezept auswählen"/></label><label>Rezept<select name="recipe_id" defaultValue=""><option value="">Kein gespeichertes Rezept</option>{recipes.map(recipe=><option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}</select></label><label>Tag<input name="meal_date" type="date" defaultValue={weekStart} min={weekStart} max={days[6].toISOString().slice(0,10)} required/></label><label>Mahlzeit<select name="meal_type"><option value="dinner">Abendessen</option><option value="lunch">Mittagessen</option><option value="breakfast">Frühstück</option></select></label><label>Portionen<input name="servings" type="number" min="1" step="1" defaultValue="2"/></label><button className="button button-dark" disabled={busy}><Plus size={16}/> Hinzufügen</button></div></form></section>}
        {tab === 'shopping' && <section><div className="page-heading"><div><div className="eyebrow">ZUSAMMEN EINKAUFEN</div><h1>Einkaufsliste</h1><p>Abhaken synchronisiert sich direkt zwischen euren Geräten.</p></div><div className="heading-icon"><ShoppingBasket size={25}/></div></div><div className="shopping-layout"><div className="panel add-panel"><span className="eyebrow">AUF DIE LISTE</span><h2>Was fehlt noch?</h2><form onSubmit={addShoppingItem} className="stack-form"><label>Artikel<input name="name" placeholder="z. B. Paprika" required/></label><div className="form-row"><label>Menge<input name="quantity" type="number" min="0" step="0.1" placeholder="2"/></label><label>Einheit<input name="unit" placeholder="Stück"/></label></div><label>Kategorie<select name="aisle"><option>Obst & Gemüse</option><option>Fleisch & Fisch</option><option>Molkerei</option><option>Trockenware</option><option>Tiefkühl</option><option>Haushalt</option><option>Sonstiges</option></select></label><button className="button button-dark button-full"><Plus size={16}/> Artikel hinzufügen</button></form></div><div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">WOCHENEINKAUF</span><h2>{shoppingTotals.length} zusammengefasste Artikel</h2><small className="muted">{recipeDemand.length} Positionen aus geplanten Rezepten und Nahrungsmitteln plus manuelle Ergänzungen</small></div><span className="list-counter">{remaining} manuell offen</span></div><div className="shopping-view-switch"><button type="button" className={shoppingView==='total'?'selected':''} onClick={()=>setShoppingView('total')}>Gesamteinkauf</button><button type="button" className={shoppingView==='recipes'?'selected':''} onClick={()=>setShoppingView('recipes')}>Nach Rezepten</button></div>{shopping.some(i=>i.checked)&&<button type="button" className="button button-light button-small" style={{marginBottom:12}} onClick={deleteCheckedShopping}><Trash2 size={14}/> Abgehakte löschen ({shopping.filter(i=>i.checked).length})</button>}{shoppingView==='total' ? (shoppingTotals.length ? <><div className="shopping-summary-note">Doppelte Zutaten werden addiert. Euer Vorrat wird einmal vom Gesamtbedarf abgezogen.</div>{Object.entries(shoppingTotals.reduce<Record<string,typeof shoppingTotals>>((acc,item)=>{(acc[item.aisle]??=[]).push(item);return acc},{})).map(([group,items])=><div className="shopping-group" key={group}><h3>{group}</h3>{items.map((item,index)=>{const manual=shopping.find(m=>m.name.toLocaleLowerCase('de-DE').trim()===item.name.toLocaleLowerCase('de-DE').trim()&&(m.unit||'').toLocaleLowerCase('de-DE').trim()===(item.unit||'').toLocaleLowerCase('de-DE').trim());return <div className="shopping-total-row" key={group+'-'+item.name+'-'+index}>{manual&&<button className={manual.checked?'check-circle checked':'check-circle'} onClick={()=>toggleShopping(manual)} aria-label="Manuellen Artikel abhaken">{manual.checked&&<Check size={13}/>}</button>}<div className="shopping-total-main"><b>{item.name}</b><small>Bedarf: {item.needed===null?'Menge offen':`${Number(item.needed.toFixed(2))} ${item.unit||''}`} · Vorrat: {item.pantry} {item.unit||''}</small></div><strong>{item.toBuy===null?'Menge offen':item.toBuy>0?`${Number(item.toBuy.toFixed(2))} ${item.unit||''}`:'Im Vorrat vorhanden'}</strong>{item.manual&&<span className="manual-tag">Manuell</span>}</div>})}</div>)}</> : <div className="empty-state"><ShoppingBasket size={30}/><b>Noch kein Einkaufsbedarf.</b><span>Plane Rezepte oder ergänze links Artikel.</span></div>) : (meals.length||shopping.length ? <>{meals.map(meal=>{const recipe=recipes.find(r=>r.id===meal.recipe_id);const lines=recipeDemand.filter(line=>line.mealId===meal.id);return <div className="recipe-shopping-card" key={meal.id}><div className="recipe-shopping-head"><div><b>{meal.custom_title||recipe?.title||'Freies Gericht'}</b><small>{new Date(meal.meal_date+'T12:00:00').toLocaleDateString('de-DE',{weekday:'long',day:'2-digit',month:'2-digit'})} · {mealLabel(meal.meal_type)} · {meal.servings} Portionen</small></div><span>{recipe?'Rezept':meal.food_item_id?'Einzeln':'Ohne Rezept'}</span></div>{lines.length?lines.map((line,i)=><div className="recipe-ingredient-line" key={meal.id+'-'+i}><span>{line.name}</span><b>{line.quantity===null?'Menge offen':`${Number(line.quantity.toFixed(2))} ${line.unit||''}`}</b></div>):<p className="muted">{recipe?'Für dieses Rezept sind noch keine Zutaten hinterlegt.':meal.food_item_id?'Menge offen.':'Freies Gericht – keine Zutatenliste vorhanden.'}</p>}</div>})}{shopping.length>0&&<div className="recipe-shopping-card"><div className="recipe-shopping-head"><div><b>Manuell hinzugefügt</b><small>Artikel, die ihr unabhängig von Rezepten ergänzt habt</small></div><span>{shopping.length} Artikel</span></div>{shopping.map(item=><div className="recipe-ingredient-line" key={item.id}><button className={item.checked?'check-circle checked':'check-circle'} onClick={()=>toggleShopping(item)} aria-label="Manuellen Artikel abhaken">{item.checked&&<Check size={13}/>}</button><span>{item.name}</span><b>{item.quantity??'Menge offen'} {item.unit||''}</b></div>)}</div>}</> : <div className="empty-state"><BookOpen size={30}/><b>Noch keine Rezepte im Wochenplan.</b><span>Wähle im Wochenplan ein gespeichertes Rezept aus.</span></div>)}</div></div></section>}
        {tab === 'pantry' && <section><div className="page-heading"><div><div className="eyebrow">WENIGER VERSCHWENDEN</div><h1>Dein Vorrat</h1><p>Was da ist, muss nicht noch einmal gekauft werden.</p></div><div className="heading-icon"><Warehouse size={25}/></div></div><div className="shopping-layout"><div className="panel add-panel"><span className="eyebrow">VORRAT ERGÄNZEN</span><h2>Was habt ihr da?</h2><form className="stack-form" onSubmit={addPantryItem}><label>Zutat<input name="name" placeholder="z. B. Kartoffeln" required/></label><div className="form-row"><label>Menge<input name="quantity" type="number" min="0" step="0.1" placeholder="1"/></label><label>Einheit<input name="unit" placeholder="kg"/></label></div><label>Mindesthaltbar bis<input name="best_before" type="date"/></label><label>Lagerort<select name="storage_location"><option>Vorratsschrank</option><option>Kühlschrank</option><option>Gefrierfach</option><option>Keller</option></select></label><button className="button button-dark button-full"><Plus size={16}/> Zum Vorrat</button></form></div><div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">EURE ZUTATEN</span><h2>{pantry.length} Vorratsartikel</h2></div><Search size={19}/></div>{pantry.length?pantry.map(item=><div className="pantry-row" key={item.id}><div className="pantry-icon"><Apple size={18}/></div><div className="pantry-name"><b>{item.name}</b><small>{item.storage_location || 'Vorrat'} {item.best_before?'· MHD '+new Date(item.best_before+'T12:00:00').toLocaleDateString('de-DE'):''}</small></div><span>{item.quantity??''} {item.unit??''}</span><div className="meal-actions"><button type="button" onClick={()=>deletePantryItem(item)} aria-label={item.name+' aus dem Vorrat löschen'}><Trash2 size={13}/></button></div></div>):<div className="empty-state"><Warehouse size={30}/><b>Noch ist der Vorrat leer.</b><span>Trage eure Zutaten ein, damit wir sie beim Planen berücksichtigen können.</span></div>}</div></div></section>}
        {tab === 'foods' && <section>
          <div className="page-heading"><div><div className="eyebrow">EURE ZUTATENBASIS</div><h1>Nahrungsmittel</h1><p>{foods.length} Einträge im gemeinsamen Katalog.</p></div><div className="heading-icon"><Apple size={25}/></div></div>
          <div className="shopping-layout">
            <form className="panel add-panel stack-form" onSubmit={addFood}><span className="eyebrow">NEUES NAHRUNGSMITTEL</span><h2>Eintrag anlegen</h2>
              <label>Name<input name="name" placeholder="z. B. Hähnchenbrustfilet" required/></label>
              <label>Kategorie<select name="category"><option>Gemüse</option><option>Obst</option><option>Kräuter & Gewürze</option><option>Fleisch & Fisch</option><option>Milchprodukte & Eier</option><option>Getreide & Backwaren</option><option>Hülsenfrüchte & Konserven</option><option>Öle & Saucen</option><option>Nüsse & Saaten</option><option>Backen & Süßes</option><option>Getränke</option><option>Sonstiges</option></select></label>
              <label>Standardeinheit<input name="default_unit" placeholder="z. B. g, ml, Stück"/></label><label>Notiz<input name="notes" placeholder="Optional"/></label>
              <button className="button button-dark button-full"><Plus size={16}/> Nahrungsmittel speichern</button></form>
            <div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">KATALOG</span><h2>{foods.length} Einträge</h2></div><Apple size={19}/></div>
              <label>Suchen<input value={foodSearch} onChange={e=>setFoodSearch(e.target.value)} placeholder="Nahrungsmittel suchen …"/></label>
              {Object.entries(foods.filter(f=>f.name.toLocaleLowerCase('de-DE').includes(foodSearch.toLocaleLowerCase('de-DE')) || f.category.toLocaleLowerCase('de-DE').includes(foodSearch.toLocaleLowerCase('de-DE'))).reduce<Record<string,FoodItem[]>>((groups,food)=>{ (groups[food.category] ??= []).push(food); return groups },{})).map(([category,items])=><div className="food-category" key={category}><h3>{category} <small>{items.length}</small></h3>{items.map(food=><div className="food-row" key={food.id}><div className="pantry-icon"><Apple size={16}/></div><div className="pantry-name"><b>{food.name}</b><small>{food.default_unit || 'Einheit bei Bedarf'}{foodPrices.find(p=>p.food_item_id===food.id) ? ' · '+foodPrices.find(p=>p.food_item_id===food.id)!.source_name+' · '+new Date(foodPrices.find(p=>p.food_item_id===food.id)!.observed_at+'T12:00:00').toLocaleDateString('de-DE') : ''}</small></div>{foodPrices.find(p=>p.food_item_id===food.id) ? <span className="food-price">{euro(Number(foodPrices.find(p=>p.food_item_id===food.id)!.price_eur))}<small>{foodPrices.find(p=>p.food_item_id===food.id)!.package_quantity} {foodPrices.find(p=>p.food_item_id===food.id)!.package_unit}</small></span> : <span className="food-source">Preis folgt per Bon</span>}</div>)}</div>)}
            </div></div><div className="notice-card"><Sparkles size={18}/><span>Für 58 Nahrungsmittel sind bereits recherchierte Referenzpreise hinterlegt. Sie stammen aus einer Online-Preiserhebung (Juni 2026), können regional abweichen und werden mit euren Einkaufsbons nach und nach durch echte Ladenpreise ergänzt.</span></div>
          </section>}
        {tab === 'recipes' && <section><div className="page-heading"><div><div className="eyebrow">EURE REZEPTSAMMLUNG</div><h1>Rezepte</h1><p>Lieblingsgerichte sammeln – Cookidoo-Import kommt als nächster Schritt.</p></div><div className="heading-icon"><BookOpen size={25}/></div></div><div className="shopping-layout"><form className="panel add-panel stack-form" onSubmit={addRecipe}><span className="eyebrow">NEUES REZEPT</span><h2>Gericht speichern</h2><label>Name<input name="title" placeholder="z. B. Hähnchen-Gemüse-Pfanne" required/></label><label>Kurzbeschreibung<input name="description" placeholder="Was macht das Gericht besonders?"/></label><div className="form-row"><label>Portionen<input name="servings" type="number" min="1" defaultValue="2"/></label><label>Vorbereitung (Min.)<input name="prep_minutes" type="number" min="0" placeholder="15"/></label></div><label>Kochzeit (Min.)<input name="cook_minutes" type="number" min="0" placeholder="25"/></label><div className="ingredient-picker"><b>Zutaten aus dem Nahrungsmittel-Katalog</b><small>Zutaten markieren und die Menge pro Rezeptportion eintragen. Ohne Menge erscheint später „Menge offen“.</small>{foods.map(food=><div className="ingredient-edit-row" key={food.id}><label className="ingredient-check"><input type="checkbox" name="food_ids" value={food.id}/><span>{food.name}</span></label><input name={'quantity_'+food.id} type="number" min="0" step="0.1" placeholder="Menge" aria-label={'Menge '+food.name}/><input name={'unit_'+food.id} defaultValue={food.default_unit||''} placeholder="Einheit" aria-label={'Einheit '+food.name}/></div>)}</div><button className="button button-dark button-full" disabled={busy}><Plus size={16}/> Rezept speichern</button></form><div className="panel shopping-list-panel"><div className="panel-head"><div><span className="eyebrow">EURE SAMMLUNG</span><h2>{recipes.length} Rezepte</h2></div><BookOpen size={19}/></div>{recipes.length?recipes.map(recipe=><div className="recipe-card-editable" key={recipe.id}><div className="recipe-row"><div className="pantry-icon"><CookingPot size={18}/></div><div className="pantry-name"><b>{recipe.title}</b><small>{recipe.description || 'Eigenes Rezept'} · {recipe.servings} Portionen · {(recipe.recipe_ingredients||[]).length} Zutaten · ≈ {euro(estimateRecipeCost(recipe,recipe.servings,foods,foodPrices).total)}{estimateRecipeCost(recipe,recipe.servings,foods,foodPrices).missing.length?' (Preise unvollständig)':''}</small></div><span>{[recipe.prep_minutes,recipe.cook_minutes].filter(Boolean).length?[recipe.prep_minutes,recipe.cook_minutes].filter(Boolean).reduce((a,b)=>Number(a)+Number(b),0)+' Min.':'–'}</span><div className="meal-actions"><button type="button" onClick={()=>openDetails(recipe.id,null)} aria-label="Anleitung und Kosten öffnen"><BookOpen size={14}/></button><button type="button" onClick={()=>setEditingRecipeId(editingRecipeId===recipe.id?null:recipe.id)} aria-label="Rezept bearbeiten"><Edit3 size={14}/></button><button type="button" onClick={()=>deleteRecipe(recipe)} aria-label="Rezept löschen"><Trash2 size={14}/></button></div></div>{editingRecipeId===recipe.id&&<form className="recipe-edit-form" onSubmit={saveRecipeEdit}><label>Name<input name="title" defaultValue={recipe.title} required/></label><label>Kurzbeschreibung<input name="description" defaultValue={recipe.description||''}/></label><div className="form-row"><label>Portionen<input name="servings" type="number" min="1" defaultValue={recipe.servings}/></label><label>Vorbereitung (Min.)<input name="prep_minutes" type="number" min="0" defaultValue={recipe.prep_minutes??''}/></label><label>Kochzeit (Min.)<input name="cook_minutes" type="number" min="0" defaultValue={recipe.cook_minutes??''}/></label></div><div className="ingredient-picker"><b>Zutaten und Mengen</b><small>Vorhandene Zutaten sind vorausgewählt. Häkchen entfernen, um Zutaten zu löschen.</small>{foods.map(food=>{const ingredient=(recipe.recipe_ingredients||[]).find(item=>item.food_item_id===food.id);return <div className="ingredient-edit-row" key={food.id}><label className="ingredient-check"><input type="checkbox" name="food_ids" value={food.id} defaultChecked={Boolean(ingredient)}/><span>{food.name}</span></label><input name={'quantity_'+food.id} type="number" min="0" step="0.1" defaultValue={ingredient?.quantity??''} placeholder="Menge" aria-label={'Menge '+food.name}/><input name={'unit_'+food.id} defaultValue={ingredient?.unit||food.default_unit||''} placeholder="Einheit" aria-label={'Einheit '+food.name}/></div>})}</div><div className="meal-edit-actions"><button className="button button-dark" disabled={busy}>Änderungen speichern</button><button className="button button-light" type="button" onClick={()=>setEditingRecipeId(null)}>Abbrechen</button></div></form>}</div>):<div className="empty-state"><BookOpen size={30}/><b>Noch keine Rezepte gespeichert.</b><span>Füge links euer erstes Lieblingsgericht hinzu.</span></div>}</div></div><div className="preference-chips">{settings?.histamine_low_enabled&&<span><Leaf size={14}/> Histaminbewusst</span>}{settings?.tomato_free_enabled&&<span>Tomatenfrei</span>}{settings?.cream_free_enabled&&<span>Sahnefrei</span>}{settings?.vegetable_rich_enabled&&<span>Gemüsereich</span>}</div><div className="notice-card"><Sparkles size={18}/><span>Cookidoo-Rezepte können wir im nächsten Ausbauschritt über einen Link oder durch manuelle Übernahme ergänzen.</span></div></section>}
        {tab === 'receipts' && <ReceiptScanner householdId={household.id} userId={session.user.id} onDone={refreshData} />}
        {tab === 'prices' && <section><div className="page-heading"><div><div className="eyebrow">CLEVER VERGLEICHEN</div><h1>Supermarktpreise</h1><p>Preisverlauf und Angebotsvergleich für Erfurt.</p></div><div className="heading-icon"><Store size={25}/></div></div><div className="retailer-grid">{[['ALDI Nord','aldi_nord'],['Lidl','lidl'],['REWE','rewe'],['Kaufland','kaufland'],['EDEKA','edeka'],['Penny','penny']].map(([name,code])=>{const count=foodPrices.filter(p=>p.retailer_code===code).length;return <div className="retailer-card" key={code}><div className="retailer-logo">{name.slice(0,1)}</div><b>{name}</b><span>{count} recherchierte Preisangaben</span><small>{count?'Quellenpreise vorhanden':'Noch keine belastbaren Einzelpreise'}</small></div>})}</div><div className="panel price-catalog-panel"><div className="panel-head"><div><span className="eyebrow">ONLINE RECHERCHIERT</span><h2>{foodPrices.length} Preisangaben für {new Set(foodPrices.map(p=>p.food_item_id)).size} Nahrungsmittel</h2></div><CircleDollarSign size={20}/></div>{foods.filter(food=>foodPrices.some(p=>p.food_item_id===food.id)).map(food=>{const price=foodPrices.find(p=>p.food_item_id===food.id)!;return <div className="price-catalog-row" key={food.id}><div className="pantry-name"><b>{food.name}</b><small>{price.retailer_code.replace('_',' ')} · {price.source_name} · {new Date(price.observed_at+'T12:00:00').toLocaleDateString('de-DE')}</small></div><div className="price-catalog-value"><b>{euro(Number(price.price_eur))}</b><small>{price.package_quantity} {price.package_unit}</small></div></div>})}</div><div className="notice-card"><Store size={19}/><span>Die Onlinepreise sind Referenzwerte und können je nach Filiale, Marke, Packungsgröße und Aktionswoche abweichen. Die Preisbasis wird mit euren Einkaufsbons ergänzt und nach und nach durch echte Erfurter Ladenpreise ersetzt. Nicht belegte Preise bleiben leer – wir schätzen sie nicht einfach.</span></div></section>}
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
  const hasUrl = Boolean(import.meta.env.VITE_SUPABASE_URL)
  const hasKey = Boolean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  return <div className="loading-screen"><div className="brand-mark">B.</div><h1>BLANKMANN</h1><p>Die Verbindung zur Datenbank fehlt noch.</p><div className="setup-instructions">Build-Diagnose (es werden keine Schlüssel angezeigt):<br /><code>VITE_SUPABASE_URL</code>: {hasUrl ? 'vorhanden' : 'FEHLT'}<br /><code>VITE_SUPABASE_PUBLISHABLE_KEY</code>: {hasKey ? 'vorhanden' : 'FEHLT'}<br /><br />Wenn eine Variable fehlt, kommt sie nicht im Vite-Build an. Bitte die Build-Variablen im richtigen Cloudflare-Worker-Projekt prüfen und anschließend neu deployen.</div></div>
}
