import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Camera, Check, CircleDollarSign, LoaderCircle, ReceiptText, Sparkles, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { prepareReceiptImages } from '../lib/receiptImage'
import { checkReceiptTotal, editDistance, findReceiptTotal, normalize, parseReceipt, type Food, type Line, type OCRWord } from '../lib/receiptParser'

type Receipt = { id: string; image_path: string; retailer_code: string | null; purchase_date: string | null; status: string; created_at: string }

declare global {
  interface Window { Tesseract?: { createWorker: (language: string, oem?: number, options?: Record<string, unknown>) => Promise<{ recognize: (image: Blob | File) => Promise<{ data: { text: string; confidence?: number; words?: { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] } }>; setParameters?: (params: Record<string,string>) => Promise<void>; terminate: () => Promise<void> }> } }
}

const retailers: Record<string,string> = { aldi_nord:'ALDI Nord', lidl:'Lidl', rewe:'REWE', kaufland:'Kaufland', edeka:'EDEKA', penny:'Penny', other:'Anderer Markt' }
const euro = (value: number) => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value)
const categories: [string, RegExp][] = [
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
  const [purchaseDate,setPurchaseDate]=useState(new Date().toISOString().slice(0,10))
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
  function addManualLine(){setLines(current=>[...current,{id:crypto.randomUUID(),name:'',price:'',foodId:'',quantity:'',unit:'',selected:true}])}
  function removeLine(id:string){setLines(current=>current.filter(line=>line.id!==id))}
  async function analyse(receipt:Receipt) {
    if(!supabase)return
    setBusy(true);setError('');setNotice('');setProgress('Privaten Bon laden …');setActiveReceipt(receipt);setLines([]);setOcrText('');setReceiptTotal(null)
    let worker:Awaited<ReturnType<NonNullable<typeof window.Tesseract>['createWorker']>>|null=null
    try{
      const downloaded=await supabase.storage.from('receipt-photos').download(receipt.image_path)
      if(downloaded.error)throw downloaded.error
      if(receiptPreview)URL.revokeObjectURL(receiptPreview)
      setReceiptPreview(URL.createObjectURL(downloaded.data))
      setProgress('Bild wird aufbereitet (Lichtausgleich) …')
      const variants=await prepareReceiptImages(downloaded.data)
      const attempts:{data:{text:string;confidence?:number;words?:OCRWord[]};label:string;score:number;parsed:Line[]}[]=[]

      setProgress('Texterkennung wird geladen …')
      const api=await loadTesseract()
      worker=await api.createWorker('deu+eng',1,{logger:(m:any)=>{if(typeof m.progress==='number')setProgress('Tesseract liest den Bon: '+Math.round(Number(m.progress)*100)+' %')}})
      for(const variant of variants)for(const mode of ['6','4']){
        setProgress('Bon wird gelesen ('+variant.label+', Modus '+mode+') …')
        if(worker.setParameters)await worker.setParameters({tessedit_pageseg_mode:mode,preserve_interword_spaces:'1',user_defined_dpi:'300'})
        const result=await worker.recognize(variant.blob)
        const parsed=parseReceipt(result.data.text,foods,result.data.words||[])
        attempts.push({data:result.data,label:variant.label+' · PSM '+mode,score:scoreOCR(result.data.text,result.data.words||[]),parsed})
      }
      if(!attempts.length)throw new Error('Texterkennung lieferte kein Ergebnis.')
      // OCR-Durchläufe ergänzen einander: eine Position wird nicht verworfen,
      // nur weil eine andere Bildaufbereitung oder Segmentierung besser bewertet wurde.
      const merged:Line[]=[]
      for(const attempt of [...attempts].sort((a,b)=>(b.parsed.filter(x=>x.price).length*100+b.parsed.length*10+b.score/100)-(a.parsed.filter(x=>x.price).length*100+a.parsed.length*10+a.score/100))){
        for(const line of attempt.parsed){
          const same=(candidate:Line)=>{
            const a=normalize(candidate.name),b=normalize(line.name)
            if(a===b)return true
            const aliases:Record<string,string>={'bio zucch':'bio zucchini','bio zucchini':'bio zucchini','bid eier':'bio eier','bio eier':'bio eier','milprima':'milprima butter','milprima butter':'milprima butter','kartofreechips':'kartoffelchips','kartoffelchips':'kartoffelchips','meersalz':'meersalz grob','meersalz grob':'meersalz grob'}
            if((aliases[a]||a)===(aliases[b]||b))return true
            return Boolean(candidate.foodId&&line.foodId&&candidate.foodId===line.foodId&&
              Math.abs(a.length-b.length)<=4&&editDistance(a,b)<=Math.max(2,Math.floor(Math.min(a.length,b.length)*0.22)))
          }
          const existing=merged.find(same)
          if(!existing){merged.push(line);continue}
          if(!existing.price&&line.price){
            existing.price=line.price;existing.selected=true
            if(line.quantity){existing.quantity=line.quantity;existing.unit=line.unit}
            if(line.foodId){existing.foodId=line.foodId;existing.name=line.name}
            continue
          }
          if(existing.price&&line.price&&existing.price!==line.price)continue
          if(existing.name.length<line.name.length&&line.foodId){existing.name=line.name;existing.foodId=line.foodId}
          if(!existing.quantity&&line.quantity){existing.quantity=line.quantity;existing.unit=line.unit}
          if(!existing.quantity&&line.quantity){existing.quantity=line.quantity;existing.unit=line.unit}
        }
      }
      const best=[...attempts].sort((a,b)=>b.parsed.filter(x=>x.price).length-a.parsed.filter(x=>x.price).length||b.parsed.length-a.parsed.length||b.score-a.score)[0]
      // Bon-Summe: der am häufigsten gelesene Wert aus allen Durchläufen.
      const totalCounts=new Map<number,number>()
      for(const attempt of attempts){const value=findReceiptTotal(attempt.data.text,attempt.data.words||[]);if(value!==null)totalCounts.set(value,(totalCounts.get(value)||0)+1)}
      const billTotal=[...totalCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??null
      // Stimmt ein einzelner Durchlauf exakt mit der Bon-Summe überein, wird nur dieser genommen (keine Doppelzeilen durch das Zusammenführen).
      const exact=billTotal===null?undefined:[...attempts].filter(a=>checkReceiptTotal(a.parsed,billTotal).ok).sort((a,b)=>b.parsed.filter(x=>x.price).length-a.parsed.filter(x=>x.price).length||b.score-a.score)[0]
      const parsed=exact?exact.parsed:merged
      const priceCount=parsed.filter(line=>line.price).length
      const reviewCount=parsed.length-priceCount
      const textResults=attempts.map(a=>'--- '+a.label+' ---\n'+a.data.text).join('\n\n')
      setOcrText(textResults);setOcrMethod(attempts.length+' OCR-Durchläufe (Tesseract, Lichtausgleich) · '+(exact?'Summe stimmt im Lauf '+exact.label:'keine Übereinstimmung mit der Bon-Summe, Durchläufe zusammengeführt')+' · bester Lauf: '+best.label+' · '+priceCount+' Preispositionen · '+reviewCount+' Prüfzeilen')
      setReceiptTotal(billTotal)
      setRetailer(receipt.retailer_code||'other');setPurchaseDate(receipt.purchase_date||new Date(receipt.created_at).toISOString().slice(0,10));setProgress('')
      if(!parsed.length)throw new Error('Die Texterkennung hat keine Artikelzeilen erkannt. Alle OCR-Rohdurchläufe bleiben zur Kontrolle sichtbar. Bitte ein scharfes, möglichst gerade aufgenommenes Foto verwenden.')
      setLines(parsed)
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
    if(!window.confirm('Sicher, dass du das Element „Bon '+retailerName+' vom '+dateLabel+'“ löschen willst? Das Foto wird ebenfalls entfernt. Bereits gespeicherte Preisverläufe bleiben erhalten.'))return
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
      setNotice('Bon und Foto wurden gelöscht. Bereits gespeicherte Preisverläufe bleiben erhalten.')
    }catch(e){setError(e instanceof Error?e.message:'Bon konnte nicht vollständig gelöscht werden.')}
    finally{setBusy(false)}
  }
  async function savePrices(){
    if(!supabase||!activeReceipt)return
    setBusy(true);setError('');setNotice('');setProgress('Artikel und Preise werden gespeichert …')
    try{
      let added=0
      const foodIdByName=new Map(foods.map(food=>[normalize(food.name),food.id]))
      for(const line of lines.filter(l=>l.selected)){
        const price=Number(line.price.replace(',','.'))
        if(!line.name.trim()||!Number.isFinite(price)||price<=0)continue
        let foodId=line.foodId
        if(!foodId){
          const norm=normalize(line.name)
          const existingId=foodIdByName.get(norm)
          if(existingId)foodId=existingId
          else{
            const created=await supabase.from('household_foods').insert({household_id:householdId,name:line.name.trim(),normalized_name:norm,category:guessCategory(line.name),default_unit:line.unit||null,notes:'Automatisch aus Kassenbon ergänzt',source_name:'receipt',created_by:userId}).select('id').single()
            if(created.error)throw created.error
            foodId=created.data.id
            foodIdByName.set(norm,foodId)
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
        const priceData={household_id:householdId,food_item_id:foodId,retailer_code:activeReceipt.retailer_code||retailer,price_eur:price,package_quantity:quantity,package_unit:unit,unit_price_eur:unitPrice,unit_label:unitLabel,price_type:'regular',source_name:'Kassenbon '+(retailers[activeReceipt.retailer_code||retailer]||'Supermarkt'),observed_at:activeReceipt.purchase_date||purchaseDate,notes:receiptNote}
        if(duplicate.data){const updatedPrice=await supabase.from('household_food_prices').update(priceData).eq('id',duplicate.data.id);if(updatedPrice.error)throw updatedPrice.error}
        else{const inserted=await supabase.from('household_food_prices').insert(priceData);if(inserted.error)throw inserted.error}
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
      <div className="panel-head"><div><span className="eyebrow">OCR-ERGEBNIS PRÜFEN</span><h2>{lines.filter(l=>Number(l.price.replace(',','.'))>0).length} Positionen mit Preis · {lines.filter(l=>!Number(l.price.replace(',','.'))).length} zur Prüfung</h2><small>Auch Zeilen ohne erkannten Preis bleiben sichtbar. Ergänze fehlende Preise und prüfe die Zuordnung, bevor du speicherst.</small></div><Sparkles size={20}/></div>
      {check.total!==null
        ?<div className={'alert '+(check.ok?'success':'error')} role={check.ok?undefined:'alert'}>{check.ok&&<Check size={16}/>}{check.ok?'Summe stimmt mit dem Bon überein: ':'Summe weicht vom Bon ab: '}Bon {euro(check.total)} · erkannt {euro(check.itemsTotal)}{!check.ok&&<> · Differenz {euro(check.diff??0)}. Bitte Positionen und Preise mit dem Bon vergleichen.</>}</div>
        :<div className="notice-card"><Sparkles size={18}/><span>Die Bon-Summe konnte nicht gelesen werden. Bitte die Preise selbst mit dem Bon vergleichen.</span></div>}
      <div className="receipt-review-tools"><button type="button" className="button button-light button-small" onClick={addManualLine} disabled={busy}>+ Artikel manuell ergänzen</button></div>
      {lines.map(line=><div className="receipt-line-edit" key={line.id}>
        <input aria-label="Artikelname" value={line.name} onChange={e=>updateLine(line.id,{name:e.target.value})}/>
        <input aria-label="Preis in Euro" placeholder="Preis €" inputMode="decimal" value={line.price} onChange={e=>updateLine(line.id,{price:e.target.value})}/>
        <select aria-label="Nahrungsmittel zuordnen" value={line.foodId} onChange={e=>updateLine(line.id,{foodId:e.target.value})}><option value="">+ Neu anlegen: {line.name}</option>{foods.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <div className="form-row"><input aria-label="Packungsmenge" placeholder="Menge" value={line.quantity} onChange={e=>updateLine(line.id,{quantity:e.target.value})}/><input aria-label="Einheit" placeholder="g, kg, ml …" value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}/></div>
        <div className="receipt-include"><label><input type="checkbox" checked={line.selected} onChange={e=>updateLine(line.id,{selected:e.target.checked})}/> Übernehmen</label><button type="button" className="button button-light button-small" onClick={()=>removeLine(line.id)} aria-label="Artikelzeile entfernen">Entfernen</button></div>
      </div>)}
      <div className="receipt-save-row"><b>{selectedCount} Positionen · {euro(lines.filter(l=>l.selected).reduce((sum,l)=>sum+(Number(l.price.replace(',','.'))||0),0))}</b><button className="button button-dark" disabled={busy||!selectedCount} onClick={savePrices}><CircleDollarSign size={16}/> Preise & Nahrungsmittel speichern</button></div>
    </div>}
    {activeReceipt&&receiptPreview&&<div className="panel receipt-image-check"><div className="panel-head"><div><span className="eyebrow">QUELLBILD</span><h2>Bonfoto zur Kontrolle</h2><small>So sieht die Texterkennung die gespeicherte Datei.</small></div></div><img src={receiptPreview} alt="Hochgeladenes Kassenbonfoto"/></div>}
    {activeReceipt&&ocrText&&<details className="panel"><summary>Erkannten Bontext zur Kontrolle anzeigen</summary><small>{ocrMethod}</small><p>Die Rohtexte aller Durchläufe dienen der Diagnose. Nur plausible Artikelzeilen erscheinen oben in der Prüfliste; unklare Zeilen werden nicht automatisch als Lebensmittel gespeichert.</p><pre style={{whiteSpace:'pre-wrap',fontSize:12,overflowWrap:'anywhere'}}>{ocrText}</pre></details>}
    <div className="notice-card"><Sparkles size={18}/><span>Unsichere oder unvollständige Zeilen bleiben zur manuellen Prüfung sichtbar. Unbekannte Artikel werden beim Speichern automatisch als neue Nahrungsmittel angelegt. Die Erkennung erfolgt lokal im Browser; nur die von euch bestätigten Positionen werden als Preise gespeichert. Erneut ausgewertete Bons werden nach dem Speichern als erledigt markiert.</span></div>
  </section>
}
