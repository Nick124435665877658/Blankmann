import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Camera, Check, CircleDollarSign, LoaderCircle, ReceiptText, Sparkles, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { prepareReceiptImages } from '../lib/receiptImage'
import { checkReceiptTotal, combineReceiptRuns, findReceiptDiscount, findReceiptTotal, likelyFood, normalize, parseReceipt, type Food, type Line, type OCRWord } from '../lib/receiptParser'
import { canSplitToOne, normalizeUnit, pantryAmountFromReceipt, planPantryAddition, splitOrganic, type PantryRow } from '../lib/kitchen'
import { localISO } from '../lib/dates'
import { saveMarketPrice } from '../lib/priceStore'
import { retailers } from '../lib/retailers'
import { guessCategory, storageFor } from '../lib/categories'

type Receipt = { id: string; image_path: string; retailer_code: string | null; purchase_date: string | null; status: string; created_at: string }

declare global {
  interface Window { Tesseract?: { createWorker: (language: string, oem?: number, options?: Record<string, unknown>) => Promise<{ recognize: (image: Blob | File) => Promise<{ data: { text: string; confidence?: number; words?: { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] } }>; setParameters?: (params: Record<string,string>) => Promise<void>; terminate: () => Promise<void> }> } }
}

// Bio ist ein Merkmal, kein eigenes Nahrungsmittel: „BIO EIER 6ER“ → „EIER 6ER“ + Bio, zugeordnet zu „Eier“.
// Für die Zuordnung zählen Packungsangaben wie „6ER“ oder „500G“ nicht mit.
const withoutPack=(name:string)=>name.replace(/\b\d+(?:[,.]\d+)?\s*(?:er|stk|st|stück|g|kg|ml|l)\b/gi,' ').replace(/\s+/g,' ').trim()
function markOrganic(line:Line,foods:Food[]):Line{
  const split=splitOrganic(line.name)
  if(!split.organic)return line
  const current=line.foodId?foods.find(f=>f.id===line.foodId):undefined
  const keep=current&&!splitOrganic(current.name).organic?current:undefined
  const match=keep??likelyFood(split.base,foods)??likelyFood(withoutPack(split.base),foods)
  return {...line,name:match?.name??split.base,foodId:match?.id??'',organic:true}
}
const euro = (value: number) => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value)
function scoreOCR(text:string,words:OCRWord[]=[]){
  const confidence=words.length?words.reduce((sum,w)=>sum+(w.confidence??0),0)/words.length:0
  const prices=(text.match(/\b\d{1,4}[,.]\d{2}\b/g)||[]).length
  const useful=(text.match(/[A-Za-zÄÖÜäöüß0-9]/g)||[]).length/Math.max(1,text.length)
  return confidence*0.65+prices*7+useful*18
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
  const [purchaseDate,setPurchaseDate]=useState(localISO())
  const [lines,setLines]=useState<Line[]>([])
  const [activeReceipt,setActiveReceipt]=useState<Receipt|null>(null)
  const [busy,setBusy]=useState(false)
  const [progress,setProgress]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [ocrText,setOcrText]=useState('')
  const [receiptPreview,setReceiptPreview]=useState('')
  const [ocrMethod,setOcrMethod]=useState('')
  const [receiptTotal,setReceiptTotal]=useState<number|null>(null)
  // Rabatt auf den ganzen Bon („10% auf Alles“): nur Hinweis – Preise werden als normale Ladenpreise gespeichert (Nick, 20.11.).
  const [receiptDiscount,setReceiptDiscount]=useState<{label:string;amount:number}|null>(null)
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
  // Summenkontrolle: erkannte Preise (inkl. Rabatt und Pfand) gegen die SUMME auf dem Bon, live bei jeder Änderung.
  const check=useMemo(()=>checkReceiptTotal(lines,receiptTotal),[lines,receiptTotal])
  function updateLine(id:string,patch:Partial<Line>){setLines(current=>current.map(line=>line.id===id?{...line,...patch}:line))}
  function addManualLine(){setLines(current=>[...current,{id:crypto.randomUUID(),name:'',price:'',foodId:'',quantity:'',unit:'',selected:true,organic:false}])}
  function removeLine(id:string){setLines(current=>current.filter(line=>line.id!==id))}
  async function analyse(receipt:Receipt) {
    if(!supabase)return
    setBusy(true);setError('');setNotice('');setProgress('Privaten Bon laden …');setActiveReceipt(receipt);setLines([]);setOcrText('');setReceiptTotal(null);setReceiptDiscount(null)
    let worker:Awaited<ReturnType<NonNullable<typeof window.Tesseract>['createWorker']>>|null=null
    try{
      const downloaded=await supabase.storage.from('receipt-photos').download(receipt.image_path)
      if(downloaded.error)throw downloaded.error
      if(receiptPreview)URL.revokeObjectURL(receiptPreview)
      setReceiptPreview(URL.createObjectURL(downloaded.data))
      setProgress('Bild wird aufbereitet (Lichtausgleich) …')
      const attempts:{data:{text:string;confidence?:number;words?:OCRWord[]};label:string;score:number;parsed:Line[]}[]=[]

      setProgress('Texterkennung wird geladen …')
      const api=await loadTesseract()
      const ocr=await api.createWorker('deu+eng',1,{logger:(m:any)=>{if(typeof m.progress==='number')setProgress('Tesseract liest den Bon: '+Math.round(Number(m.progress)*100)+' %')}})
      worker=ocr
      const readVariant=async(variant:{label:string;blob:Blob})=>{
        for(const mode of ['6','4']){
          setProgress('Bon wird gelesen ('+variant.label+', Modus '+mode+') …')
          if(ocr.setParameters)await ocr.setParameters({tessedit_pageseg_mode:mode,preserve_interword_spaces:'1',user_defined_dpi:'300'})
          const result=await ocr.recognize(variant.blob)
          const parsed=parseReceipt(result.data.text,foods,result.data.words||[])
          attempts.push({data:result.data,label:variant.label+' · PSM '+mode,score:scoreOCR(result.data.text,result.data.words||[]),parsed})
        }
      }
      // Bon-Summe: der am häufigsten gelesene Wert aus allen Durchläufen.
      const readTotal=()=>{
        const totalCounts=new Map<number,number>()
        for(const attempt of attempts){const value=findReceiptTotal(attempt.data.text,attempt.data.words||[]);if(value!==null)totalCounts.set(value,(totalCounts.get(value)||0)+1)}
        return [...totalCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??null
      }
      // Durchläufe Zeile für Zeile abgleichen (keine Doppelzeilen) und mit der Bon-Summe gegenprüfen.
      const combine=()=>combineReceiptRuns(attempts.map(a=>({label:a.label,lines:a.parsed})),readTotal())
      for(const variant of await prepareReceiptImages(downloaded.data))await readVariant(variant)
      let combined=combine()
      if(!checkReceiptTotal(combined.lines,readTotal()).ok||combined.lines.some(line=>line.review==='derived')){
        // Summe passt noch nicht (oder nur mit berechnetem Preis): dieselbe Aufbereitung in anderer Größe liest Ziffern oft anders.
        setProgress('Summe passt noch nicht – zweiter Lesedurchgang mit anderer Bildgröße …')
        for(const variant of await prepareReceiptImages(downloaded.data,0.8))await readVariant(variant)
        combined=combine()
      }
      if(!attempts.length)throw new Error('Texterkennung lieferte kein Ergebnis.')
      const best=[...attempts].sort((a,b)=>b.parsed.filter(x=>x.price).length-a.parsed.filter(x=>x.price).length||b.parsed.length-a.parsed.length||b.score-a.score)[0]
      const billTotal=readTotal()
      const parsed=combined.lines
      const priceCount=parsed.filter(line=>line.price).length
      const reviewCount=parsed.length-priceCount
      const textResults=attempts.map(a=>'--- '+a.label+' ---\n'+a.data.text).join('\n\n')
      setOcrText(textResults);setOcrMethod(attempts.length+' OCR-Durchläufe (Tesseract, Lichtausgleich) · '+combined.summary+' · bester Lauf: '+best.label+' · '+priceCount+' Preispositionen · '+reviewCount+' Prüfzeilen')
      setReceiptTotal(billTotal)
      setReceiptDiscount(attempts.map(a=>findReceiptDiscount(a.data.text)).find(Boolean)??null)
      setRetailer(receipt.retailer_code||'other');setPurchaseDate(receipt.purchase_date||localISO(new Date(receipt.created_at)));setProgress('')
      if(!parsed.length)throw new Error('Die Texterkennung hat keine Artikelzeilen erkannt. Alle OCR-Rohdurchläufe bleiben zur Kontrolle sichtbar. Bitte ein scharfes, möglichst gerade aufgenommenes Foto verwenden.')
      setLines(parsed.map(line=>markOrganic(line,foods)))
    }catch(e){setError(e instanceof Error?e.message:'Bon-Auswertung fehlgeschlagen.')}
    finally{if(worker)await worker.terminate().catch(()=>{});setBusy(false)}
  }
  async function uploadAndAnalyse(file:File){
    if(!supabase)return
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){setError('Bitte JPG, PNG oder WebP bis maximal 10 MB verwenden.');return}
    setBusy(true);setError('');setNotice('');setProgress('Bon wird sicher hochgeladen …')
    try{
      const path=householdId+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
      const uploaded=await supabase.storage.from('receipt-photos').upload(path,file,{contentType:file.type,upsert:false})
      if(uploaded.error)throw uploaded.error
      const inserted=await supabase.from('receipt_uploads').insert({household_id:householdId,image_path:path,retailer_code:retailer,purchase_date:purchaseDate||null,created_by:userId}).select('id,image_path,retailer_code,purchase_date,status,created_at').single()
      if(inserted.error){await supabase.storage.from('receipt-photos').remove([path]);throw inserted.error}
      const receipt=inserted.data as Receipt
      await refresh();setProgress('Upload abgeschlossen – OCR startet …')
      setBusy(false);await analyse(receipt)
    }catch(e){setError(e instanceof Error?e.message:'Upload fehlgeschlagen.');setBusy(false);setProgress('')}
  }
  function handleFileChange(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0]
    e.target.value=''
    if(file)void uploadAndAnalyse(file)
  }
  async function deleteReceipt(receipt:Receipt){
    if(!supabase||busy)return
    const retailerName=retailers[receipt.retailer_code||'']||'Supermarkt'
    const dateLabel=receipt.purchase_date?new Date(receipt.purchase_date+'T12:00:00').toLocaleDateString('de-DE'):new Date(receipt.created_at).toLocaleDateString('de-DE')
    if(!window.confirm('Sicher, dass du das Element „Bon '+retailerName+' vom '+dateLabel+'“ löschen willst? Das Foto wird ebenfalls entfernt. Bereits gespeicherte Preise bleiben erhalten.'))return
    setBusy(true);setError('');setNotice('')
    try{
      // Remove the private file first. If this fails, keep the receipt row so the user can retry.
      const removed=await supabase.storage.from('receipt-photos').remove([receipt.image_path])
      if(removed.error)throw new Error('Das Bonfoto konnte nicht gelöscht werden. Der Bon bleibt deshalb in der Liste: '+removed.error.message)
      const deleted=await supabase.from('receipt_uploads').delete().eq('id',receipt.id).eq('household_id',householdId).select('id').maybeSingle()
      if(deleted.error)throw new Error('Das Foto wurde entfernt, aber der Bon-Datensatz blieb bestehen. Bitte erneut auf Löschen tippen: '+deleted.error.message)
      if(!deleted.data)throw new Error('Das Foto wurde entfernt, aber der Bon-Datensatz blieb bestehen. Bitte erneut auf Löschen tippen.')
      setReceipts(current=>current.filter(item=>item.id!==receipt.id))
      if(activeReceipt?.id===receipt.id){setActiveReceipt(null);setLines([]);setOcrText('');if(receiptPreview)URL.revokeObjectURL(receiptPreview);setReceiptPreview('')}
      setNotice('Bon und Foto wurden gelöscht. Bereits gespeicherte Preise bleiben erhalten.')
    }catch(e){setError(e instanceof Error?e.message:'Bon konnte nicht vollständig gelöscht werden.')}
    finally{setBusy(false)}
  }
  async function savePrices(){
    if(!supabase||!activeReceipt)return
    setBusy(true);setError('');setNotice('');setProgress('Artikel und Preise werden gespeichert …')
    try{
      let added=0,stocked=0
      const foodIdByName=new Map(foods.map(food=>[normalize(food.name),food.id]))
      // Vorrat: nur beim ersten Speichern eines Bons ergänzen (erneutes Auswerten zählt sonst doppelt).
      const fillPantry=activeReceipt.status!=='processed'
      const pantryRows:PantryRow[]=[]
      const packages=new Map<string,{package_quantity:number|null;package_unit:string|null}>()
      if(fillPantry){
        const [stock,packs]=await Promise.all([
          supabase.from('pantry_items').select('id,name,quantity,unit,food_item_id,best_before,is_organic').eq('household_id',householdId),
          supabase.from('household_food_prices').select('food_item_id,package_quantity,package_unit,observed_at').eq('household_id',householdId).not('package_quantity','is',null).order('observed_at',{ascending:false}),
        ])
        if(stock.error)throw stock.error
        if(packs.error)throw packs.error
        pantryRows.push(...((stock.data??[]) as PantryRow[]))
        // Packungsgröße je Nahrungsmittel: bevorzugt eine echte Menge (g/ml), sonst die neueste Angabe.
        for(const row of (packs.data??[]) as {food_item_id:string;package_quantity:number|null;package_unit:string|null}[]){
          const known=packages.get(row.food_item_id)
          if(!known||(normalizeUnit(known.package_unit).base==='stk'&&normalizeUnit(row.package_unit).base!=='stk'))packages.set(row.food_item_id,row)
        }
      }
      // Ein Preis je Nahrungsmittel + Supermarkt + Bio/normal: vorhandener Preis desselben Markts wird überschrieben.
      const market=retailer||activeReceipt.retailer_code||'other'
      const observedAt=purchaseDate||activeReceipt.purchase_date||localISO()
      for(const line of lines.filter(l=>l.selected)){
        const price=Number(line.price.replace(',','.'))
        const split=splitOrganic(line.name.trim())
        const organic=Boolean(line.organic)||split.organic
        const name=split.base
        if(!name||!Number.isFinite(price)||price<=0)continue
        let foodId=line.foodId
        if(!foodId){
          const norm=normalize(name)
          const existingId=foodIdByName.get(norm)
          if(existingId)foodId=existingId
          else{
            const created=await supabase.from('household_foods').insert({household_id:householdId,name,normalized_name:norm,category:guessCategory(name),default_unit:line.unit||null,notes:'Automatisch aus Kassenbon ergänzt',source_name:'receipt',created_by:userId}).select('id').single()
            if(created.error)throw created.error
            foodId=created.data.id
            foodIdByName.set(norm,foodId)
            setFoods(current=>[...current,{id:foodId,name,normalized_name:norm,category:guessCategory(name),default_unit:line.unit||null}])
          }
        }
        const qtyText=line.quantity.replace(',','.')
        const quantity=qtyText&&Number.isFinite(Number(qtyText))&&Number(qtyText)>0?Number(qtyText):null
        const unit=line.unit||null
        await saveMarketPrice({householdId,foodId,retailerCode:market,organic,price,quantity,unit,splitToOne:Boolean(line.splitToOne),sourceName:'Kassenbon '+(retailers[market]||'Supermarkt'),observedAt,notes:'receipt:'+activeReceipt.id})
        added++
        if(fillPantry&&normalize(name)!=='pfand'){
          // Der Vorrat bekommt die gekaufte Menge (z. B. 2 Stk), auch wenn der Preis auf 1 Stk runtergerechnet wird.
          const amount=pantryAmountFromReceipt({quantity,unit},packages.get(foodId))
          const plan=planPantryAddition(pantryRows,{name,foodId,quantity:amount.quantity,unit:amount.unit,organic})
          if(plan.update){
            const changed=await supabase.from('pantry_items').update({quantity:plan.update.quantity,updated_at:new Date().toISOString()}).eq('id',plan.update.id).eq('household_id',householdId)
            if(changed.error)throw changed.error
            const row=pantryRows.find(r=>r.id===plan.update!.id);if(row)row.quantity=plan.update.quantity
          }else if(plan.insert){
            const category=guessCategory(name)
            const created=await supabase.from('pantry_items').insert({household_id:householdId,name:plan.insert.name,normalized_name:normalize(plan.insert.name),quantity:plan.insert.quantity,unit:plan.insert.unit,food_item_id:foodId,is_organic:organic,storage_location:storageFor(category),notes:'Aus Kassenbon vom '+new Date(observedAt+'T12:00:00').toLocaleDateString('de-DE')}).select('id,name,quantity,unit,food_item_id,best_before,is_organic').single()
            if(created.error)throw created.error
            pantryRows.push(created.data as PantryRow)
          }
          stocked++
        }
      }
      const updated=await supabase.from('receipt_uploads').update({status:'processed',retailer_code:market,purchase_date:observedAt}).eq('id',activeReceipt.id).eq('household_id',householdId)
      if(updated.error)throw updated.error
      setNotice(added+' Preise für '+(retailers[market]||'den Supermarkt')+' gespeichert (je Nahrungsmittel ein Preis pro Markt – geänderte Preise überschrieben). Neue Nahrungsmittel wurden automatisch ergänzt. '+(fillPantry?stocked+' Positionen im Vorrat ergänzt.':'Der Vorrat wurde bei diesem Bon bereits beim ersten Speichern ergänzt.'));setLines([]);setActiveReceipt(null);setProgress('');await refresh();await onDone()
    }catch(e){setError(e instanceof Error?e.message:'Preise konnten nicht vollständig gespeichert werden.');setProgress('')}
    finally{setBusy(false)}
  }
  return <section>
    <div className="page-heading"><div><div className="eyebrow">PREISDATENBANK FÜTTERN</div><h1>Kassenbon-Auswertung</h1><p>Foto hochladen, Artikel erkennen und Preise in euren Haushaltskatalog übernehmen.</p></div><div className="heading-icon"><ReceiptText size={25}/></div></div>
    <div className="shopping-layout">
      <div className="panel add-panel stack-form receipt-upload-panel">
        <span className="eyebrow">NEUER KASSENBON</span><h2>Bon fotografieren</h2>
        <div className="receipt-meta-fields"><label>Supermarkt<select name="retailer" value={retailer} onChange={e=>setRetailer(e.target.value)}>{Object.entries(retailers).map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
        <label>Einkaufsdatum<input name="purchase_date" type="date" value={purchaseDate} onChange={e=>setPurchaseDate(e.target.value)}/></label></div>
        <div className="receipt-upload-actions"><label className="receipt-file-label"><Camera size={19}/> Foto aufnehmen<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={handleFileChange} disabled={busy}/></label>
        <label className="receipt-file-label"><Upload size={19}/> Bild auswählen<input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={busy}/></label></div>
        <small>JPG, PNG oder WebP · maximal 10 MB. Die Texterkennung läuft direkt in eurem Browser; das Bonfoto bleibt im privaten Haushaltsspeicher.</small>
      </div>
      <div className="panel shopping-list-panel">
        <div className="panel-head"><div><span className="eyebrow">EURE BELEGE</span><h2>{receipts.length} hochgeladen</h2></div><ReceiptText size={19}/></div>
        {receipts.length?receipts.map(r=><div className="pantry-row" key={r.id}><div className="pantry-icon"><ReceiptText size={18}/></div><div className="pantry-name"><b>{retailers[r.retailer_code||'']||'Supermarkt'}</b><small>{r.purchase_date?new Date(r.purchase_date+'T12:00:00').toLocaleDateString('de-DE'):new Date(r.created_at).toLocaleDateString('de-DE')} · {r.status==='processed'?'Ausgewertet':'Wartet auf Auswertung'}</small></div><div className="form-row receipt-list-actions"><button type="button" className="button button-light button-small" disabled={busy} onClick={()=>analyse(r)}>{r.status==='processed'?'Erneut auswerten':'Auswerten'}</button><button type="button" className="button button-light button-small" disabled={busy} onClick={()=>deleteReceipt(r)} aria-label="Bon löschen">Löschen</button></div></div>):<div className="empty-state"><Camera size={30}/><b>Noch keine Bons gespeichert.</b><span>Der erste Bon legt den Grundstein für eure Preisverläufe.</span></div>}
      </div>
    </div>
    {progress&&<div className="notice-card"><LoaderCircle size={18}/><span>{progress}</span></div>}
    {error&&<div className="alert error" role="alert">{error}</div>}
    {notice&&<div className="alert success"><Check size={16}/>{notice}</div>}
    {activeReceipt&&lines.length>0&&<div className="panel receipt-review">
      <div className="panel-head"><div><span className="eyebrow">OCR-ERGEBNIS PRÜFEN</span><h2>{lines.filter(l=>Number(l.price.replace(',','.'))>0).length} Positionen mit Preis · {lines.filter(l=>!Number(l.price.replace(',','.'))).length} zur Prüfung</h2><small>Auch Zeilen ohne erkannten Preis bleiben sichtbar. Ergänze fehlende Preise und prüfe die Zuordnung, bevor du speicherst.</small><small><b>Supermarkt: {retailers[retailer]||'Anderer Markt'}</b> (oben unter „Supermarkt“ änderbar) · je Nahrungsmittel wird ein Preis für diesen Markt gespeichert, ein älterer Preis desselben Markts wird ersetzt. „Bio“ wird automatisch erkannt.</small></div><Sparkles size={20}/></div>
      {check.total!==null
        ?<div className={'alert '+(check.ok?'success':'error')} role={check.ok?undefined:'alert'}>{check.ok&&<Check size={16}/>}{check.ok?'Summe stimmt mit dem Bon überein: ':'Summe weicht vom Bon ab: '}Bon {euro(check.total)} · erkannt {euro(check.itemsTotal)}{!check.ok&&<> · Differenz {euro(check.diff??0)}. Bitte Positionen und Preise mit dem Bon vergleichen.</>}</div>
        :<div className="notice-card"><Sparkles size={18}/><span>Die Bon-Summe konnte nicht gelesen werden. Bitte die Preise selbst mit dem Bon vergleichen.</span></div>}
      {receiptDiscount&&<div className="notice-card"><Sparkles size={18}/><span>Rabatt auf den ganzen Bon: „{receiptDiscount.label}“ −{euro(receiptDiscount.amount)}{check.total!==null?' (bezahlt '+euro(Math.max(0,check.total-receiptDiscount.amount))+')':''}. Die Preise werden ohne diesen Rabatt gespeichert – als normale Ladenpreise.</span></div>}
      {lines.some(l=>l.note)&&<div className="notice-card"><Sparkles size={18}/><span>{lines.filter(l=>l.note).length} Zeile(n) haben einen Hinweis{lines.some(l=>l.review==='derived')?' – ein unleserlicher Preis wurde aus der Bon-Summe berechnet, die Summe stimmt dadurch automatisch':''}. Bitte diese Zeilen mit dem Bon vergleichen.</span></div>}
      <div className="receipt-review-tools"><button type="button" className="button button-light button-small" onClick={addManualLine} disabled={busy}>+ Artikel manuell ergänzen</button></div>
      {lines.map(line=><div className="receipt-line-edit" key={line.id}>
        <input aria-label="Artikelname" value={line.name} onChange={e=>updateLine(line.id,{name:e.target.value})}/>
        <input aria-label="Preis in Euro" placeholder="Preis €" inputMode="decimal" value={line.price} onChange={e=>updateLine(line.id,{price:e.target.value})}/>
        <select aria-label="Nahrungsmittel zuordnen" value={line.foodId} onChange={e=>updateLine(line.id,{foodId:e.target.value})}><option value="">+ Neu anlegen: {line.name}</option>{foods.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <div className="form-row"><input aria-label="Packungsmenge" placeholder="Menge" value={line.quantity} onChange={e=>updateLine(line.id,{quantity:e.target.value})}/><input aria-label="Einheit" placeholder="g, kg, ml …" value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}/></div>
        <div className="receipt-include"><label><input type="checkbox" checked={line.selected} onChange={e=>updateLine(line.id,{selected:e.target.checked})}/> Übernehmen</label><label><input type="checkbox" checked={Boolean(line.organic)} onChange={e=>updateLine(line.id,{organic:e.target.checked})}/> Bio</label>{canSplitToOne(Number(line.quantity.replace(',','.'))||null,line.unit||null)&&<label title="Preis wird für 1 Stück gespeichert, der Vorrat bekommt die ganze Menge"><input type="checkbox" checked={Boolean(line.splitToOne)} onChange={e=>updateLine(line.id,{splitToOne:e.target.checked})}/> Auf 1 {line.unit||'Stk'} runterrechnen{line.splitToOne&&Number(line.price.replace(',','.'))>0?' ('+euro(Math.round(Number(line.price.replace(',','.'))/Number(line.quantity.replace(',','.'))*100)/100)+')':''}</label>}<button type="button" className="button button-light button-small" onClick={()=>removeLine(line.id)} aria-label="Artikelzeile entfernen">Entfernen</button></div>
        {line.note&&<small className="muted" style={{gridColumn:'1/-1',fontSize:10}}>⚠ {line.note}</small>}
      </div>)}
      <div className="receipt-save-row"><b>{selectedCount} Positionen · {euro(lines.filter(l=>l.selected).reduce((sum,l)=>sum+(Number(l.price.replace(',','.'))||0),0))}</b><button className="button button-dark" disabled={busy||!selectedCount} onClick={savePrices}><CircleDollarSign size={16}/> Preise & Nahrungsmittel speichern</button></div>
    </div>}
    {activeReceipt&&receiptPreview&&<div className="panel receipt-image-check"><div className="panel-head"><div><span className="eyebrow">QUELLBILD</span><h2>Bonfoto zur Kontrolle</h2><small>So sieht die Texterkennung die gespeicherte Datei.</small></div></div><img src={receiptPreview} alt="Hochgeladenes Kassenbonfoto"/></div>}
    {activeReceipt&&ocrText&&<details className="panel"><summary>Erkannten Bontext zur Kontrolle anzeigen</summary><small>{ocrMethod}</small><p>Die Rohtexte aller Durchläufe dienen der Diagnose. Nur plausible Artikelzeilen erscheinen oben in der Prüfliste; unklare Zeilen werden nicht automatisch als Lebensmittel gespeichert.</p><pre style={{whiteSpace:'pre-wrap',fontSize:12,overflowWrap:'anywhere'}}>{ocrText}</pre></details>}
    <div className="notice-card"><Sparkles size={18}/><span>Unsichere oder unvollständige Zeilen bleiben zur manuellen Prüfung sichtbar. Unbekannte Artikel werden beim Speichern automatisch als neue Nahrungsmittel angelegt. Die Erkennung erfolgt lokal im Browser; nur die von euch bestätigten Positionen werden als Preise gespeichert. Erneut ausgewertete Bons werden nach dem Speichern als erledigt markiert. Beim ersten Speichern eines Bons kommen die übernommenen Positionen außerdem in euren Vorrat.</span></div>
  </section>
}
