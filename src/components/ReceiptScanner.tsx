import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Camera, Check, CircleDollarSign, LoaderCircle, ReceiptText, Sparkles, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Food = { id: string; name: string; normalized_name: string; category: string; default_unit: string | null }
type Receipt = { id: string; image_path: string; retailer_code: string | null; purchase_date: string | null; status: string; created_at: string }
type Line = { id: string; name: string; price: string; foodId: string; quantity: string; unit: string; selected: boolean }

declare global {
  interface Window { Tesseract?: { createWorker: (language: string, oem?: number, options?: Record<string, unknown>) => Promise<{ recognize: (image: Blob | File) => Promise<{ data: { text: string; words?: { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] } }>; terminate: () => Promise<void> }> } }
}

const retailers: Record<string,string> = { aldi_nord:'ALDI Nord', lidl:'Lidl', rewe:'REWE', kaufland:'Kaufland', edeka:'EDEKA', penny:'Penny', other:'Anderer Markt' }
const normalize = (value: string) => value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()
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
type OCRWord = { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
function parseReceipt(text:string, foods:Food[], words:OCRWord[] = []):Line[] {
  const found:Line[]=[]
  const add=(rawName:string, rawPrice:string, rawQuantity='', rawUnit='')=>{
    let name=rawName.replace(/^\\d+\\s*[xX×]\\s*/,'').replace(/[|_]+/g,' ').replace(/\\s+/g,' ').trim()
    name=name.replace(/\\s+(?:[A-Z*])$/,'').trim()
    if(name.length<3 || /^(summe|gesamt|zwischensumme|bar|ec|visa|mastercard|gegeben|rueckgeld|wechselgeld|mwst|ust|steuer|netto|brutto|rabatt|ersparnis|kartenzahlung|kundennummer|datum|uhrzeit|bon|kasse|bedienung|artikel|anzahl|eur|pfand)\\b/i.test(name)) return
    const price=Number(rawPrice.replace(',','.'))
    if(!Number.isFinite(price)||price<=0||price>500) return
    const norm=normalize(name)
    const exact=foods.find(f=>f.normalized_name===norm || normalize(f.name)===norm)
    const likely=exact ?? foods.find(f=>norm.length>5 && (norm.includes(normalize(f.name))||normalize(f.name).includes(norm)))
    const pack=name.match(/(?:^|\\s)(\\d+(?:[,.]\\d+)?)\\s*(kg|g|mg|l|ml|stk|stück)\\b/i)
    found.push({id:crypto.randomUUID(),name,price:price.toFixed(2).replace('.',','),foodId:likely?.id??'',quantity:rawQuantity||pack?.[1]?.replace('.',',')||'',unit:rawUnit||pack?.[2]?.toLowerCase()||'',selected:true})
  }
  // Prefer word coordinates: supermarket receipts put the product name on the left
  // and the amount in a separate right-hand column.
  if(words.length){
    const sorted=[...words].filter(w=>w.text.trim()).sort((a,b)=>((a.bbox.y0+a.bbox.y1)-(b.bbox.y0+b.bbox.y1))||a.bbox.x0-b.bbox.x0)
    const rows:{y:number;words:OCRWord[]}[]=[]
    for(const word of sorted){
      const y=(word.bbox.y0+word.bbox.y1)/2
      let row=rows.find(r=>Math.abs(r.y-y)<=Math.max(10,(word.bbox.y1-word.bbox.y0)*0.55))
      if(!row){row={y,words:[]};rows.push(row)}
      row.words.push(word)
      row.y=row.words.reduce((s,w)=>s+(w.bbox.y0+w.bbox.y1)/2,0)/row.words.length
    }
    rows.sort((a,b)=>a.y-b.y)
    for(let i=0;i<rows.length;i++){
      const row=rows[i], rowWords=row.words.sort((a,b)=>a.bbox.x0-b.bbox.x0)
      const rowText=rowWords.map(w=>w.text).join(' ').replace(/\\s+/g,' ').trim()
      const priceMatch=[...rowText.matchAll(/(-?\\d{1,4}[,.]\\d{2})/g)].pop()
      if(!priceMatch) continue
      const amount=priceMatch[1]
      const amountIndex=rowText.lastIndexOf(amount)
      const leftText=rowText.slice(0,amountIndex).trim()
      if(/^\\d+\\s*stk?\\s*[x×]/i.test(leftText) || /^\\d+\\s*[x×]/i.test(leftText)) {
        const previous=found[found.length-1]
        const qty=leftText.match(/(\\d+)\\s*(stk|stück)?\\s*[x×]/i)
        if(previous&&qty){previous.quantity=qty[1];previous.unit='stk'}
        continue
      }
      if(Number(amount.replace(',','.'))<0 || /rabatt|\\d+%/i.test(leftText)){
        const previous=found[found.length-1]
        if(previous && (normalize(leftText).includes(normalize(previous.name).split(' ')[0]) || /rabatt|\\d+%/i.test(leftText))){
          const discounted=Number(previous.price.replace(',','.'))+Number(amount.replace(',','.'))
          if(discounted>0) previous.price=discounted.toFixed(2).replace('.',',')
        }
        continue
      }
      const nameWords=rowWords.filter(w=>w.bbox.x0 < (rowWords.find(w=>w.text.includes(amount))?.bbox.x0 ?? Infinity))
      const name=nameWords.map(w=>w.text).join(' ').trim() || leftText
      if(name && !/^(summe|gesamt|gegeben|mwst|pfand|ec-cash)/i.test(name)) add(name,amount)
    }
  }
  // Text fallback catches OCR engines/layouts that do not provide useful coordinates.
  {
    for(const raw of text.split(/\\r?\\n/)){
      const line=raw.replace(/\\s+/g,' ').trim()
      const match=line.match(/(.+?)\\s+(-?\\d{1,4}[,.]\\d{2})\\s*(?:[A-Z*])?$/i)
      if(!match || /pfand|summe|gesamt|mwst|rabatt|kartenzahlung/i.test(match[1])) continue
      const name=match[1].replace(/^\\d+\\s*[xX×]\\s*/,'').trim()
      const qty=name.match(/(\\d+)\\s*(stk|stück)?\\s*[x×]/i)
      if(qty){const previous=found[found.length-1];if(previous){previous.quantity=qty[1];previous.unit='stk'};continue}
      if(Number(match[2].replace(',','.'))<0) continue
      const norm=normalize(name)
      if(found.some(l=>normalize(l.name)===norm && l.price===match[2].replace('.',','))) continue
      add(name,match[2])
    }
  }
  // Remove duplicate detections from overlapping OCR rows/passes.
  return found.filter((line,index,all)=>all.findIndex(other=>normalize(other.name)===normalize(line.name)&&other.price===line.price)===index)
}
async function prepareReceiptImage(file:Blob):Promise<Blob>{
  const bitmap=await createImageBitmap(file)
  const scale=Math.max(1.5,Math.min(2.5,1800/bitmap.width))
  const canvas=document.createElement('canvas')
  canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale)
  const ctx=canvas.getContext('2d')
  if(!ctx){bitmap.close();return file}
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
  const image=ctx.getImageData(0,0,canvas.width,canvas.height)
  for(let i=0;i<image.data.length;i+=4){
    const gray=0.299*image.data[i]+0.587*image.data[i+1]+0.114*image.data[i+2]
    const contrast=Math.max(0,Math.min(255,(gray-128)*1.35+128))
    image.data[i]=image.data[i+1]=image.data[i+2]=contrast
  }
  ctx.putImageData(image,0,0)
  return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Bonfoto konnte nicht vorbereitet werden.')),'image/png'))
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
    setBusy(true);setError('');setNotice('');setProgress('Privaten Bon laden …');setActiveReceipt(receipt);setLines([]);setOcrText('')
    let worker:Awaited<ReturnType<NonNullable<typeof window.Tesseract>['createWorker']>>|null=null
    try{
      const downloaded=await supabase.storage.from('receipt-photos').download(receipt.image_path)
      if(downloaded.error)throw downloaded.error
      setProgress('Texterkennung wird geladen …')
      const api=await loadTesseract()
      worker=await api.createWorker('deu+eng',1,{logger:(m:any)=>{if(typeof m.progress==='number')setProgress('Bon wird gelesen: '+Math.round(Number(m.progress)*100)+' %')}})
      const prepared=await prepareReceiptImage(downloaded.data)
      const result=await worker.recognize(prepared)
      setOcrText(result.data.text)
      const parsed=parseReceipt(result.data.text,foods,result.data.words||[])
      if(!parsed.length)throw new Error('Ich konnte keine Artikelpreise erkennen. Bitte prüfe das Foto oder versuche es mit besserem Licht erneut.')
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
    {activeReceipt&&ocrText&&<details className="panel"><summary>Erkannten Bontext zur Kontrolle anzeigen</summary><pre style={{whiteSpace:'pre-wrap',fontSize:12,overflowWrap:'anywhere'}}>{ocrText}</pre></details>}
    <div className="notice-card"><Sparkles size={18}/><span>Unbekannte Artikel werden beim Speichern automatisch als neue Nahrungsmittel angelegt. Die Erkennung erfolgt lokal im Browser; nur die von euch bestätigten Positionen werden als Preise gespeichert. Erneut ausgewertete Bons werden nach dem Speichern als erledigt markiert.</span></div>
  </section>
}
