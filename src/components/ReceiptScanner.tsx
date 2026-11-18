import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Camera, Check, CircleDollarSign, LoaderCircle, ReceiptText, Sparkles, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Food = { id: string; name: string; normalized_name: string; category: string; default_unit: string | null }
type Receipt = { id: string; image_path: string; retailer_code: string | null; purchase_date: string | null; status: string; created_at: string }
type Line = { id: string; name: string; price: string; foodId: string; quantity: string; unit: string; selected: boolean }

declare global {
  interface Window { Tesseract?: { createWorker: (language: string, oem?: number, options?: Record<string, unknown>) => Promise<{ recognize: (image: Blob | File) => Promise<{ data: { text: string } }>; terminate: () => Promise<void> }> } }
}

const retailers: Record<string,string> = { aldi_nord:'ALDI Nord', lidl:'Lidl', rewe:'REWE', kaufland:'Kaufland', edeka:'EDEKA', penny:'Penny', other:'Anderer Markt' }
const normalize = (value: string) => value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()
const euro = (value: number) => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value)
const categories = [
  ['Fleisch & Fisch',/huhn|haehnchen|pute|rind|schwein|hack|lachs|fisch|wurst|schinken/],
  ['Milchprodukte & Eier',/milch|joghurt|quark|kaese|butter|ei(er)?|skyr/],
  ['Gemüse',/paprika|gurke|zucchini|kartoffel|tomate|brokkoli|salat|karotte|zwiebel|pilz|champignon/],
  ['Obst',/apfel|banane|traube|beere|orange|zitrone|birne/],
  ['Getreide & Backwaren',/brot|broetchen|toast|mehl|reis|nudel|pasta|wrap|hafer/],
  ['Hülsenfrüchte & Konserven',/bohne|linse|kichererbse|dose|mais/],
  ['Öle & Saucen',/oel|essig|sauce|pesto/],
  ['Backen & Süßes',/schokolade|keks|zucker|honig|marmelade/],
]
function guessCategory(name:string) { const n=normalize(name); return categories.find(([,re])=>re.test(n))?.[0] ?? 'Sonstiges' }
function parseReceipt(text:string, foods:Food[]):Line[] {
  const ignored=/^(summe|gesamt|zwischensumme|bar|ec|visa|mastercard|gegeben|rueckgeld|wechselgeld|mwst|ust|steuer|netto|brutto|rabatt|ersparnis|kartenzahlung|kundennummer|datum|uhrzeit|bon|kasse|bedienung|artikel|anzahl|eur|eur\s)/i
  const found:Line[]=[]
  for (const raw of text.split(/\r?\n/)) {
    const line=raw.replace(/\s+/g,' ').trim()
    if(line.length<4 || ignored.test(line)) continue
    const match=line.match(/(.+?)\s+(-?\d{1,4}[,.]\d{2})\s*(?:[A-Z*])?$/i)
    if(!match) continue
    let name=match[1].replace(/^\d+\s*[xX×]\s*/,'').replace(/[|_]+/g,' ').replace(/\s{2,}/g,' ').trim()
    if(name.length<3 || /summe|gesamt|mwst|pfand|rabatt|kartenzahlung/i.test(name)) continue
    const price=Number(match[2].replace(',','.'))
    if(!Number.isFinite(price)||price<=0||price>500) continue
    const norm=normalize(name)
    const exact=foods.find(f=>f.normalized_name===norm || normalize(f.name)===norm)
    const likely=exact ?? foods.find(f=>norm.length>5 && (norm.includes(normalize(f.name))||normalize(f.name).includes(norm)))
    const pack=name.match(/(?:^|\s)(\d+(?:[,.]\d+)?)\s*(kg|g|mg|l|ml|stk|stück)\b/i)
    found.push({id:crypto.randomUUID(),name,price:price.toFixed(2).replace('.',','),foodId:likely?.id??'',quantity:pack?.[1]?.replace('.',',')??'',unit:pack?.[2]?.toLowerCase()??'',selected:true})
  }
  return found
}
async function loadTesseract() {
  if(window.Tesseract) return window.Tesseract
  await new Promise<void>((resolve,reject)=>{
    const existing=document.querySelector<HTMLScriptElement>('script[data-blankmann-tesseract]')
    if(existing){ existing.addEventListener('load',()=>resolve(),{once:true}); existing.addEventListener('error',()=>reject(new Error('OCR-Bibliothek konnte nicht geladen werden.')),{once:true}); return }
    const script=document.createElement('script'); script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'; script.async=true; script.dataset.blankmannTesseract='true'
    script.onload=()=>resolve(); script.onerror=()=>reject(new Error('OCR-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.')); document.head.appendChild(script)
  })
  if(!window.Tesseract) throw new Error('OCR konnte nicht gestartet werden.')
  return window.Tesseract
}

export default function ReceiptScanner({householdId,userId,onDone}:{householdId:string;userId:string;onDone:()=>Promise<void>}) {
  const [foods,setFoods]=useState<Food[]>([])
  const [receipts,setReceipts]=useState<Receipt[]>([])
  const [retailer,setRetailer]=useState('penny')
  const [purchaseDate,setPurchaseDate]=useState(new Date().toISOString().slice(0,10))
  const [lines,setLines]=useState<Line[]>([])
  const [activeReceipt,setActiveReceipt]=useState<Receipt|null>(null)
  const [busy,setBusy]=useState(false)
  const [progress,setProgress]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const refresh=useCallback(async()=>{
    if(!supabase)return
    const [foodRows,receiptRows]=await Promise.all([
      supabase.from('household_foods').select('id,name,normalized_name,category,default_unit').eq('household_id',householdId).order('name'),
      supabase.from('receipt_uploads').select('id,image_path,retailer_code,purchase_date,status,created_at').eq('household_id',householdId).order('created_at',{ascending:false})
    ])
    if(foodRows.error)throw foodRows.error
    if(receiptRows.error)throw receiptRows.error
    setFoods((foodRows.data??[]) as Food[]);setReceipts((receiptRows.data??[]) as Receipt[])
  },[householdId])
  useEffect(()=>{refresh().catch(e=>setError(e.message))},[refresh])
  const selectedCount=useMemo(()=>lines.filter(l=>l.selected&&Number(l.price.replace(',','.'))>0).length,[lines])
  function updateLine(id:string,patch:Partial<Line>){setLines(current=>current.map(line=>line.id===id?{...line,...patch}:line))}
  async function analyse(receipt:Receipt) {
    if(!supabase)return
    setBusy(true);setError('');setNotice('');setProgress('Privaten Bon laden …');setActiveReceipt(receipt);setLines([])
    let worker:Awaited<ReturnType<NonNullable<typeof window.Tesseract>['createWorker']>>|null=null
    try{
      const downloaded=await supabase.storage.from('receipt-photos').download(receipt.image_path)
      if(downloaded.error)throw downloaded.error
      setProgress('Texterkennung wird geladen …')
      const api=await loadTesseract()
      worker=await api.createWorker('deu+eng',1,{logger:(m:any)=>{if(typeof m.progress==='number')setProgress('Bon wird gelesen: '+Math.round(Number(m.progress)*100)+' %')}})
      const result=await worker.recognize(downloaded.data)
      const parsed=parseReceipt(result.data.text,foods)
      if(!parsed.length)throw new Error('Ich konnte keine sicheren Artikelpreise erkennen. Bitte fotografiere den Bon möglichst gerade, vollständig und scharf.')
      setLines(parsed);setRetailer(receipt.retailer_code||'other');setPurchaseDate(receipt.purchase_date||new Date(receipt.created_at).toISOString().slice(0,10));setProgress('')
    }catch(e){setError(e instanceof Error?e.message:'Bon-Auswertung fehlgeschlagen.')}
    finally{if(worker)await worker.terminate().catch(()=>{});setBusy(false)}
  }
  async function uploadAndAnalyse(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase)return
    const form=new FormData(e.currentTarget);const file=form.get('receipt')
    if(!(file instanceof File)||!file.size){setError('Bitte zuerst ein Bonfoto auswählen.');return}
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){setError('Bitte JPG, PNG oder WebP bis maximal 10 MB verwenden.');return}
    setBusy(true);setError('');setNotice('');setProgress('Bon wird sicher hochgeladen …')
    try{
      const path=householdId+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
      const uploaded=await supabase.storage.from('receipt-photos').upload(path,file,{contentType:file.type,upsert:false})
      if(uploaded.error)throw uploaded.error
      const inserted=await supabase.from('receipt_uploads').insert({household_id:householdId,image_path:path,retailer_code:String(form.get('retailer')||'other'),purchase_date:String(form.get('purchase_date')||purchaseDate)||null,created_by:userId}).select('id,image_path,retailer_code,purchase_date,status,created_at').single()
      if(inserted.error){await supabase.storage.from('receipt-photos').remove([path]);throw inserted.error}
      const receipt=inserted.data as Receipt
      await refresh();setProgress('Upload abgeschlossen – OCR startet …')
      setBusy(false);await analyse(receipt)
    }catch(e){setError(e instanceof Error?e.message:'Upload fehlgeschlagen.');setBusy(false);setProgress('')}
  }
  async function savePrices(){
    if(!supabase||!activeReceipt)return
    setBusy(true);setError('');setNotice('');setProgress('Artikel und Preise werden gespeichert …')
    try{
      let added=0
      for(const line of lines.filter(l=>l.selected)){
        const price=Number(line.price.replace(',','.'))
        if(!line.name.trim()||!Number.isFinite(price)||price<=0)continue
        let foodId=line.foodId
        if(!foodId){
          const norm=normalize(line.name)
          const existing=foods.find(f=>normalize(f.name)===norm)
          if(existing)foodId=existing.id
          else{
            const created=await supabase.from('household_foods').insert({household_id:householdId,name:line.name.trim(),normalized_name:norm,category:guessCategory(line.name),default_unit:line.unit||null,notes:'Automatisch aus Kassenbon ergänzt',source_name:'receipt',created_by:userId}).select('id').single()
            if(created.error)throw created.error
            foodId=created.data.id
            setFoods(current=>[...current,{id:foodId,name:line.name.trim(),normalized_name:norm,category:guessCategory(line.name),default_unit:line.unit||null}])
          }
        }
        const qtyText=line.quantity.replace(',','.')
        const quantity=qtyText&&Number.isFinite(Number(qtyText))?Number(qtyText):null
        const unit=line.unit||null
        let unitPrice:number|null=null;let unitLabel:string|null=null
        if(quantity&&unit){const factor=unit==='kg'||unit==='l'?1:unit==='g'||unit==='ml'?0.001:null;if(factor){unitPrice=price/(quantity*factor);unitLabel=unit==='kg'||unit==='g'?'€/kg':'€/l'}}
        const receiptNote='receipt:'+activeReceipt.id
        const duplicate=await supabase.from('household_food_prices').select('id').eq('household_id',householdId).eq('food_item_id',foodId).eq('notes',receiptNote).limit(1).maybeSingle()
        if(duplicate.error)throw duplicate.error
        if(duplicate.data)continue
        const inserted=await supabase.from('household_food_prices').insert({household_id:householdId,food_item_id:foodId,retailer_code:activeReceipt.retailer_code||retailer,price_eur:price,package_quantity:quantity,package_unit:unit,unit_price_eur:unitPrice,unit_label:unitLabel,price_type:'regular',source_name:'Kassenbon '+(retailers[activeReceipt.retailer_code||retailer]||'Supermarkt'),observed_at:activeReceipt.purchase_date||purchaseDate,notes:receiptNote})
        if(inserted.error)throw inserted.error
        added++
      }
      const updated=await supabase.from('receipt_uploads').update({status:'processed'}).eq('id',activeReceipt.id).eq('household_id',householdId)
      if(updated.error)throw updated.error
      setNotice(added+' Preispositionen gespeichert. Neue Nahrungsmittel wurden automatisch ergänzt.');setLines([]);setActiveReceipt(null);setProgress('');await refresh();await onDone()
    }catch(e){setError(e instanceof Error?e.message:'Preise konnten nicht vollständig gespeichert werden.');setProgress('')}
    finally{setBusy(false)}
  }
  return <section>
    <div className="page-heading"><div><div className="eyebrow">PREISDATENBANK FÜTTERN</div><h1>Kassenbon-Auswertung</h1><p>Foto hochladen, Artikel erkennen und Preise in euren Haushaltskatalog übernehmen.</p></div><div className="heading-icon"><ReceiptText size={25}/></div></div>
    <div className="shopping-layout">
      <form className="panel add-panel stack-form" onSubmit={uploadAndAnalyse}>
        <span className="eyebrow">NEUER KASSENBON</span><h2>Bon fotografieren</h2>
        <label>Supermarkt<select name="retailer" value={retailer} onChange={e=>setRetailer(e.target.value)}>{Object.entries(retailers).map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
        <label>Einkaufsdatum<input name="purchase_date" type="date" value={purchaseDate} onChange={e=>setPurchaseDate(e.target.value)}/></label>
        <label className="receipt-file-label"><Camera size={19}/> Foto aufnehmen oder auswählen<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required/></label>
        <small>JPG, PNG oder WebP · maximal 10 MB. Die Texterkennung läuft direkt in eurem Browser; das Bonfoto bleibt im privaten Haushaltsspeicher.</small>
        <button className="button button-dark button-full" disabled={busy}><Upload size={16}/> Bon hochladen & auswerten</button>
      </form>
      <div className="panel shopping-list-panel">
        <div className="panel-head"><div><span className="eyebrow">EURE BELEGE</span><h2>{receipts.length} hochgeladen</h2></div><ReceiptText size={19}/></div>
        {receipts.length?receipts.map(r=><div className="pantry-row" key={r.id}><div className="pantry-icon"><ReceiptText size={18}/></div><div className="pantry-name"><b>{retailers[r.retailer_code||'']||'Supermarkt'}</b><small>{r.purchase_date?new Date(r.purchase_date+'T12:00:00').toLocaleDateString('de-DE'):new Date(r.created_at).toLocaleDateString('de-DE')} · {r.status==='processed'?'Ausgewertet':'Wartet auf Auswertung'}</small></div>{r.status!=='processed'&&<button type="button" className="button button-light button-small" disabled={busy} onClick={()=>analyse(r)}>Auswerten</button>}</div>):<div className="empty-state"><Camera size={30}/><b>Noch keine Bons gespeichert.</b><span>Der erste Bon legt den Grundstein für eure Preisverläufe.</span></div>}
      </div>
    </div>
    {progress&&<div className="notice-card"><LoaderCircle size={18}/><span>{progress}</span></div>}
    {error&&<div className="alert error" role="alert">{error}</div>}
    {notice&&<div className="alert success"><Check size={16}/>{notice}</div>}
    {activeReceipt&&lines.length>0&&<div className="panel receipt-review">
      <div className="panel-head"><div><span className="eyebrow">OCR-ERGEBNIS PRÜFEN</span><h2>{lines.length} erkannte Bonpositionen</h2><small>Bitte Namen, Preis und Zuordnung kurz kontrollieren. Nicht markierte Zeilen werden ausgelassen.</small></div><Sparkles size={20}/></div>
      {lines.map(line=><div className="receipt-line-edit" key={line.id}>
        <input aria-label="Artikelname" value={line.name} onChange={e=>updateLine(line.id,{name:e.target.value})}/>
        <input aria-label="Preis in Euro" inputMode="decimal" value={line.price} onChange={e=>updateLine(line.id,{price:e.target.value})}/>
        <select aria-label="Nahrungsmittel zuordnen" value={line.foodId} onChange={e=>updateLine(line.id,{foodId:e.target.value})}><option value="">+ Neu anlegen: {line.name}</option>{foods.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <div className="form-row"><input aria-label="Packungsmenge" placeholder="Menge" value={line.quantity} onChange={e=>updateLine(line.id,{quantity:e.target.value})}/><input aria-label="Einheit" placeholder="g, kg, ml …" value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}/></div>
        <label className="receipt-include"><input type="checkbox" checked={line.selected} onChange={e=>updateLine(line.id,{selected:e.target.checked})}/> Übernehmen</label>
      </div>)}
      <div className="receipt-save-row"><b>{selectedCount} Positionen · {euro(lines.filter(l=>l.selected).reduce((sum,l)=>sum+(Number(l.price.replace(',','.'))||0),0))}</b><button className="button button-dark" disabled={busy||!selectedCount} onClick={savePrices}><CircleDollarSign size={16}/> Preise & Nahrungsmittel speichern</button></div>
    </div>}
    <div className="notice-card"><Sparkles size={18}/><span>Unbekannte Artikel werden beim Speichern automatisch als neue Nahrungsmittel angelegt. Die Erkennung erfolgt lokal im Browser; nur die von euch bestätigten Positionen werden als Preise gespeichert. Erneut ausgewertete Bons werden nach dem Speichern als erledigt markiert.</span></div>
  </section>
}
