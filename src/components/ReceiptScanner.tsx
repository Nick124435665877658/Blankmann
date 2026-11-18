import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Camera, Check, CircleDollarSign, LoaderCircle, ReceiptText, Sparkles, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Food = { id: string; name: string; normalized_name: string; category: string; default_unit: string | null }
type Receipt = { id: string; image_path: string; retailer_code: string | null; purchase_date: string | null; status: string; created_at: string }
type Line = { id: string; name: string; price: string; foodId: string; quantity: string; unit: string; selected: boolean }

declare global {
  interface Window { Tesseract?: { createWorker: (language: string, oem?: number, options?: Record<string, unknown>) => Promise<{ recognize: (image: Blob | File) => Promise<{ data: { text: string; confidence?: number; words?: { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] } }>; setParameters?: (params: Record<string,string>) => Promise<void>; terminate: () => Promise<void> }> } }
}

const retailers: Record<string,string> = { aldi_nord:'ALDI Nord', lidl:'Lidl', rewe:'REWE', kaufland:'Kaufland', edeka:'EDEKA', penny:'Penny', other:'Anderer Markt' }
const normalize = (value: string) => value.toLocaleLowerCase('de-DE').replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]+/g,' ').replace(/\s+/g,' ').trim()
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
  const isNoise=(value:string)=>/^(summe|gesamt|zwischensumme|bar|ec|visa|mastercard|gegeben|rueckgeld|wechselgeld|mwst|ust|steuer|netto|brutto|rabatt|ersparnis|kartenzahlung|kundennummer|datum|uhrzeit|bon|kasse|bedienung|artikel|anzahl|eur|pfand|cent|betrag|zu zahlen|summe eur)\b/i.test(normalize(value))
  const cleanName=(raw:string)=>{
    let name=raw.replace(/[|_]+/g,' ').replace(/[“”„"'´]/g,' ').replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim()
    name=name.replace(/\bkokosmi\s+lc\s+dad\s+ight(?:\s+.*)?$/i,'Kokosmilch Light')
    name=name.replace(/\bkokosmilch\s+d[a4]d?\s*l?i[gq]ht\b/i,'Kokosmilch Light')
    return name
  }
  const add=(rawName:string, rawPrice:string, rawQuantity='', rawUnit='')=>{
    const name=cleanName(rawName.replace(/^\d+\s*[xX×]\s*/,'').replace(/\s+\*$/,''))
    const letters=(name.match(/[\p{L}]/gu)||[]).length
    if(name.length<3 || isNoise(name) || letters<3 || letters/Math.max(1,name.length)<0.35) return
    const price=rawPrice?Number(rawPrice.replace(',','.')):NaN
    if(rawPrice&&(!Number.isFinite(price)||price<=0||price>500)) return
    const norm=normalize(name)
    const exact=foods.find(f=>normalize(f.normalized_name)===norm || normalize(f.name)===norm)
    const likely=exact ?? foods.find(f=>{
      const foodName=normalize(f.name),tokens=norm.split(' ').filter(t=>t.length>3)
      return foodName.length>4&&(norm.includes(foodName)||foodName.includes(norm)||tokens.filter(t=>foodName.split(' ').includes(t)).length>=2)
    })
    const pack=name.match(/(?:^|\s)(\d+(?:[,.]\d+)?)\s*(kg|g|mg|l|ml|stk|stück)\b/i)
    found.push({id:crypto.randomUUID(),name,price:Number.isFinite(price)?price.toFixed(2).replace('.',','):'',foodId:likely?.id??'',quantity:rawQuantity||pack?.[1]?.replace('.',',')||'',unit:rawUnit||pack?.[2]?.toLowerCase()||'',selected:Number.isFinite(price)})
  }
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
    for(const row of rows){
      const rowWords=row.words.sort((a,b)=>a.bbox.x0-b.bbox.x0)
      const rowText=rowWords.map(w=>w.text).join(' ').replace(/\s+/g,' ').trim()
      const qtyPrice=rowText.match(/(.+?)\s+(\d+(?:[,.]\d+)?)\s*[x×]\s*(\d{1,4}[,.]\d{2})\s+(-?\d{1,4}[,.]\d{2})$/i)
      if(qtyPrice){add(qtyPrice[1],qtyPrice[4],qtyPrice[2],'stk');continue}
      const total=[...rowText.matchAll(/(-?\d{1,4}[,.]\d{2})/g)].pop()
      if(!total)continue
      const amount=total[1],amountIndex=rowText.lastIndexOf(amount),leftText=rowText.slice(0,amountIndex).trim()
      const qtyOnly=leftText.match(/(?:^|\s)(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
      if(qtyOnly){
        const previous=found[found.length-1]
        if(previous){previous.quantity=qtyOnly[1].replace('.',',');previous.unit='stk';previous.price=amount.replace('.',',')}
        continue
      }
      if(Number(amount.replace(',','.'))<0||/rabatt|\d+%/i.test(leftText))continue
      const amountWord=rowWords.find(w=>w.text.includes(amount))
      const name=rowWords.filter(w=>!amountWord||w.bbox.x0<amountWord.bbox.x0).map(w=>w.text).join(' ').trim()||leftText
      if(name&&!isNoise(name))add(name,amount)
    }
  }
  let pendingText='',pendingQuantity=''
  for(const raw of text.split(/\r?\n/)){
    const line=raw.replace(/\s+/g,' ').trim()
    if(!line)continue
    const quantityOnly=line.match(/^(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
    if(quantityOnly){pendingQuantity=quantityOnly[1].replace('.',',');continue}
    const namedQuantity=line.match(/^(.+?)\s+(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
    if(namedQuantity){pendingText=cleanName(namedQuantity[1]);pendingQuantity=namedQuantity[2].replace('.',',');continue}
    const match=line.match(/(.+?)\s+(-?\d{1,4}[,.]\d{2})\s*(?:[A-Z*])?$/i)
    if(match){
      let name=match[1].trim()
      const inlineQty=name.match(/^(.+?)\s+(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
      if(inlineQty){add(inlineQty[1],match[2],inlineQty[2],'stk');pendingText='';pendingQuantity='';continue}
      const qty=name.match(/(\d+(?:[,.]\d+)?)\s*(?:stk|stück)?\s*[x×]\s*(\d{1,4}[,.]\d{2})$/i)
      if(qty){
        const productName=name.slice(0,qty.index).trim()
        if(productName)add(productName,match[2],qty[1],'stk')
        else if(found.length){found[found.length-1].quantity=qty[1];found[found.length-1].unit='stk';found[found.length-1].price=match[2].replace('.',',')}
        pendingText='';pendingQuantity='';continue
      }
      if(Number(match[2].replace(',','.'))<0||/rabatt|pfand|summe|gesamt|mwst|kartenzahlung/i.test(name))continue
      if(!name||/^[\s|:;.-]*$/.test(name))name=pendingText
      if(name&&!isNoise(name))add(name,match[2],pendingQuantity,pendingQuantity?'stk':'')
      pendingText='';pendingQuantity=''
      continue
    }
    const priceOnly=line.match(/^[-|:; ]*(-?\d{1,4}[,.]\d{2})\s*(?:[A-Z*])?$/i)
    if(priceOnly&&pendingText){
      if(Number(priceOnly[1].replace(',','.'))>0&&!isNoise(pendingText))add(pendingText,priceOnly[1],pendingQuantity,pendingQuantity?'stk':'')
      pendingText='';pendingQuantity=''
      continue
    }
    if(!isNoise(line)&&/[\p{L}]/u.test(line))pendingText=cleanName(line)
  }
  const unique:Line[]=[]
  for(const line of found){
    const key=normalize(line.name),existing=unique.findIndex(other=>normalize(other.name)===key)
    if(existing<0)unique.push(line)
    else if(!unique[existing].price&&line.price)unique[existing]=line
    else if(unique[existing].price&&line.price&&unique[existing].price===line.price){
      if(line.quantity){unique[existing].quantity=line.quantity;unique[existing].unit=line.unit}
    }else if(unique[existing].price&&line.price&&unique[existing].price!==line.price)unique.push(line)
  }
  return unique
}
async function prepareReceiptImages(file:Blob):Promise<{label:string;blob:Blob}[]>{
  const bitmap=await createImageBitmap(file)
  const scale=Math.max(0.75,Math.min(2.2,1800/bitmap.width,6500/bitmap.height))
  const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale))
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
  const ctx=canvas.getContext('2d',{willReadFrequently:true})
  if(!ctx){bitmap.close();return [{label:'Original',blob:file}]}
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);bitmap.close()
  const source=ctx.getImageData(0,0,width,height)
  const gray=new Uint8ClampedArray(width*height),histogram=new Array<number>(256).fill(0)
  for(let p=0,i=0;p<gray.length;p++,i+=4){const value=Math.round(0.299*source.data[i]+0.587*source.data[i+1]+0.114*source.data[i+2]);gray[p]=value;histogram[value]++}
  let total=gray.length,sum=0;for(let i=0;i<256;i++)sum+=i*histogram[i]
  let sumB=0,wB=0,maxVariance=0,threshold=150
  for(let i=0;i<256;i++){wB+=histogram[i];if(!wB)continue;const wF=total-wB;if(!wF)break;sumB+=i*histogram[i];const mB=sumB/wB,mF=(sum-sumB)/wF;const variance=wB*wF*(mB-mF)*(mB-mF);if(variance>maxVariance){maxVariance=variance;threshold=i}}
  const enhanced=ctx.createImageData(width,height),binary=ctx.createImageData(width,height)
  for(let p=0,i=0;p<gray.length;p++,i+=4){const contrast=Math.max(0,Math.min(255,(gray[p]-128)*1.5+128));enhanced.data[i]=enhanced.data[i+1]=enhanced.data[i+2]=contrast;enhanced.data[i+3]=255;const bw=gray[p]>threshold?255:0;binary.data[i]=binary.data[i+1]=binary.data[i+2]=bw;binary.data[i+3]=255}
  const toBlob=(data:ImageData)=>new Promise<Blob>((resolve,reject)=>{ctx.putImageData(data,0,0);canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Bild konnte nicht vorbereitet werden.')),'image/png')})
  const enhancedBlob=await toBlob(enhanced),binaryBlob=await toBlob(binary)
  return [{label:'Kontrast',blob:enhancedBlob},{label:'Schwarz-Weiß',blob:binaryBlob}]
}
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
      if(receiptPreview)URL.revokeObjectURL(receiptPreview)
      setReceiptPreview(URL.createObjectURL(downloaded.data))
      const variants=await prepareReceiptImages(downloaded.data)
      let best:{data:{text:string;confidence?:number;words?:OCRWord[]};label:string;score:number}|null=null
      for(const variant of variants){
        setProgress('Bon wird gelesen ('+variant.label+') …')
        if(worker.setParameters)await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'})
        const result=await worker.recognize(variant.blob)
        const score=scoreOCR(result.data.text,result.data.words||[])
        if(!best||score>best.score)best={data:result.data,label:variant.label,score}
      }
      if(best&&best.score<28&&worker.setParameters){
        await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'})
        const alternate=await worker.recognize(variants[0].blob)
        const score=scoreOCR(alternate.data.text,alternate.data.words||[])
        if(score>best.score)best={data:alternate.data,label:'Kontrast · freie Seitensegmentierung',score}
      }
      if(!best)throw new Error('Texterkennung lieferte kein Ergebnis.')
      setOcrText(best.data.text);setOcrMethod(best.label+' · Qualitätswert '+Math.round(best.score))
      const parsed=parseReceipt(best.data.text,foods,best.data.words||[])
      setRetailer(receipt.retailer_code||'other');setPurchaseDate(receipt.purchase_date||new Date(receipt.created_at).toISOString().slice(0,10));setProgress('')
      if(!parsed.length)throw new Error('Die Texterkennung hat noch keine verlässlichen Artikel erkannt. Das erkannte Bild und der Rohtext bleiben zur Kontrolle sichtbar. Bitte ein scharfes, möglichst gerade aufgenommenes Foto verwenden.')
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
      {lines.map(line=><div className="receipt-line-edit" key={line.id}>
        <input aria-label="Artikelname" value={line.name} onChange={e=>updateLine(line.id,{name:e.target.value})}/>
        <input aria-label="Preis in Euro" placeholder="Preis €" inputMode="decimal" value={line.price} onChange={e=>updateLine(line.id,{price:e.target.value})}/>
        <select aria-label="Nahrungsmittel zuordnen" value={line.foodId} onChange={e=>updateLine(line.id,{foodId:e.target.value})}><option value="">+ Neu anlegen: {line.name}</option>{foods.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <div className="form-row"><input aria-label="Packungsmenge" placeholder="Menge" value={line.quantity} onChange={e=>updateLine(line.id,{quantity:e.target.value})}/><input aria-label="Einheit" placeholder="g, kg, ml …" value={line.unit} onChange={e=>updateLine(line.id,{unit:e.target.value})}/></div>
        <label className="receipt-include"><input type="checkbox" checked={line.selected} onChange={e=>updateLine(line.id,{selected:e.target.checked})}/> Übernehmen</label>
      </div>)}
      <div className="receipt-save-row"><b>{selectedCount} Positionen · {euro(lines.filter(l=>l.selected).reduce((sum,l)=>sum+(Number(l.price.replace(',','.'))||0),0))}</b><button className="button button-dark" disabled={busy||!selectedCount} onClick={savePrices}><CircleDollarSign size={16}/> Preise & Nahrungsmittel speichern</button></div>
    </div>}
    {activeReceipt&&receiptPreview&&<div className="panel receipt-image-check"><div className="panel-head"><div><span className="eyebrow">QUELLBILD</span><h2>Bonfoto zur Kontrolle</h2><small>So sieht die Texterkennung die gespeicherte Datei.</small></div></div><img src={receiptPreview} alt="Hochgeladenes Kassenbonfoto"/></div>}
    {activeReceipt&&ocrText&&<details className="panel"><summary>Erkannten Bontext zur Kontrolle anzeigen</summary><small>{ocrMethod}</small><pre style={{whiteSpace:'pre-wrap',fontSize:12,overflowWrap:'anywhere'}}>{ocrText}</pre></details>}
    <div className="notice-card"><Sparkles size={18}/><span>Unsichere oder unvollständige Zeilen bleiben zur manuellen Prüfung sichtbar. Unbekannte Artikel werden beim Speichern automatisch als neue Nahrungsmittel angelegt. Die Erkennung erfolgt lokal im Browser; nur die von euch bestätigten Positionen werden als Preise gespeichert. Erneut ausgewertete Bons werden nach dem Speichern als erledigt markiert.</span></div>
  </section>
}
