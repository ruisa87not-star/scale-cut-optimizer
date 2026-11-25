import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import XLSX from 'xlsx-js-style';
import packageInfo from '../package.json';
import './styles.css';
import { createCuttingReport } from './reportWorkbook';
import { createTranslator, LANGUAGE_STORAGE_KEY, normalizeLanguage, translateError } from './localization';
import { displaySpecification, integer, mergeOrders, parseOffcutBatch, parseOffcuts, parseOrders, parseSpecification, textRows } from './orderInput';
import { formatLength as format, requestFingerprint, sortCuttingResult } from './planPresentation';
import { EmptyPlan, Field, Icon, ResultsWorkspace } from './Workbench';

function App() {
  const [language, setLanguage] = useState(() => {
    try { return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY)); } catch { return 'zh'; }
  });
  const t = useMemo(() => createTranslator(language), [language]);
  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-Hant';
    document.title = `${t('卷材裁切優化器')} ${packageInfo.version}`;
    window.cuttingOptimizer?.setLanguage?.(language);
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Switching also works without storage. */ }
  }, [language, t]);
  const [capacity, setCapacity] = useState(10000);
  const [threshold, setThreshold] = useState(150);
  const [segmentSize, setSegmentSize] = useState(50);
  const [orders, setOrders] = useState([]);
  const [offcuts, setOffcuts] = useState([]);
  const [orderDraft, setOrderDraft] = useState({ length: '', quantity: '', start: '', end: '' });
  const [offcutDraft, setOffcutDraft] = useState('');
  const [offcutQuantity, setOffcutQuantity] = useState('1');
  const [pasteText, setPasteText] = useState('');
  const [inputTab, setInputTab] = useState('orders');
  const [entryMode, setEntryMode] = useState('paste');
  const [editorOpen, setEditorOpen] = useState(true);
  const [result, setResult] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState('準備就緒');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importMode, setImportMode] = useState('orders');
  const fileInput = useRef(null);
  const errorSummary = useRef(null);
  const itemCount = useMemo(() => orders.reduce((sum, item) => sum + Number(item.quantity || 0), 0), [orders]);
  const orderLength = useMemo(() => orders.reduce((sum, item) => sum + item.length * Number(item.quantity || 0), 0), [orders]);
  const offcutLength = useMemo(() => offcuts.reduce((sum, length) => sum + length, 0), [offcuts]);
  const requestKey = useMemo(() => requestFingerprint({ capacity, threshold, segmentSize, orders, offcuts }), [capacity, threshold, segmentSize, orders, offcuts]);
  const stale = Boolean(result && snapshot?.key !== requestKey);
  const hasErrors = Boolean(error || Object.keys(fieldErrors).length);
  useEffect(() => { if (hasErrors) errorSummary.current?.focus(); }, [error, fieldErrors, hasErrors]);
  const clearErrors = () => { setError(''); setFieldErrors({}); };
  const fail = (message, field) => { setError(field ? '' : message); setFieldErrors(field ? { [field]: message } : {}); if (field?.startsWith('order-') || field === 'paste-orders') setEditorOpen(true); };
  const fieldError = id => fieldErrors[id] ? t(fieldErrors[id]) : undefined;
  const statusText = typeof status === 'string' ? t(status) : t(status.key, status.parameters);

  const addOrder = event => {
    event.preventDefault();
    const specification = parseSpecification(orderDraft.length);
    if (!specification) return fail('訂單長度與數量必須是大於 0 的整數。', 'order-length');
    const quantity = integer(orderDraft.quantity);
    if (!quantity) return fail('數量必須是大於 0 的整數。', 'order-quantity');
    const hasStart = String(orderDraft.start).trim() !== '', hasEnd = String(orderDraft.end).trim() !== '';
    const draftStart = hasStart ? integer(orderDraft.start) : 0, draftEnd = hasEnd ? integer(orderDraft.end) : 0;
    const start = hasStart ? draftStart : specification.start || 0, end = hasEnd ? draftEnd : specification.end || 0;
    if ((hasStart && !draftStart) || (hasEnd && !draftEnd)) return fail('起始與結束節段必須是大於 0 的整數。', hasStart && !draftStart ? 'order-start' : 'order-end');
    if ((specification.start || specification.end) && (hasStart || hasEnd)) return fail('請使用「160-30/30」格式，或填寫起始與結束節段其中一種方式。', 'order-length');
    if (Boolean(start) !== Boolean(end)) return fail('特殊節距規格必須同時填寫起始與結束節段。', start ? 'order-end' : 'order-start');
    if ((start && start >= Number(segmentSize)) || (end && end >= Number(segmentSize))) return fail('起始與結束節段必須小於目前節距。', 'order-length');
    setOrders(current => mergeOrders(current, [{ length: specification.length, quantity, start, end }]));
    setOrderDraft({ length: '', quantity: '', start: '', end: '' });
    clearErrors(); setStatus('訂單已新增');
  };

  const addOffcut = event => {
    event.preventDefault();
    const batch = parseOffcutBatch(offcutDraft, offcutQuantity);
    if (batch.error) return fail(batch.error, batch.field);
    setOffcuts(current => [...current, ...batch.offcuts].sort((a,b) => b-a));
    setOffcutDraft(''); setOffcutQuantity('1'); clearErrors(); setStatus('餘料已加入');
  };

  const importRows = (rows, type) => {
    const entries = type === 'orders' ? parseOrders(rows) : parseOffcuts(rows);
    if (!entries.length) { fail(type === 'orders' ? '找不到可匯入的訂單資料。' : '找不到可匯入的餘料資料。', type === 'orders' ? 'paste-orders' : undefined); return false; }
    if (type === 'orders') {
      setOrders(current => mergeOrders(current, entries));
      setEditorOpen(false);
      setStatus({ key: '已匯入 {count} 件訂單', parameters: { count: format(entries.reduce((sum,item) => sum + item.quantity,0)) } });
    } else {
      setOffcuts(current => [...current, ...entries].sort((a,b) => b-a));
      setStatus({ key: '已匯入 {count} 段餘料', parameters: { count: format(entries.length) } });
    }
    clearErrors(); return true;
  };

  const importFile = async event => {
    const file = event.target.files?.[0], requestedMode = importMode;
    event.target.value = '';
    if (!file) return;
    const type = requestedMode === 'offcuts' || file.name.toLowerCase().includes('offcut') || file.name.includes('餘料') ? 'offcuts' : 'orders';
    setInputTab(type); if (type === 'orders') setEntryMode('paste');
    try {
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        const workbook = XLSX.read(await file.arrayBuffer());
        importRows(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true }), type);
      } else importRows(textRows(await file.text()), type);
    } catch (fileError) { setError({ key: '匯入失敗：{message}', message: fileError.message }); }
  };

  const optimise = async () => {
    const validCapacity = integer(capacity), validThreshold = Number(threshold), validPitch = integer(segmentSize);
    const invalid = {};
    if (!validCapacity) invalid['stock-capacity'] = '新卷長度必須大於 0。';
    if (!Number.isSafeInteger(validThreshold) || validThreshold < 0 || String(threshold).trim() === '') invalid['stock-threshold'] = '可回收門檻必須是非負整數。';
    if (!validPitch) invalid['stock-pitch'] = '節距必須大於 0。';
    for (const order of orders) if (!integer(order.quantity)) invalid[`quantity-${order.id}`] = '數量必須是大於 0 的整數。';
    if (Object.keys(invalid).length) { setFieldErrors(invalid); setError(''); setInputTab('orders'); return; }
    if (!orders.length) { setInputTab('orders'); setEntryMode('paste'); return fail('請先新增或匯入客戶訂單。', 'paste-orders'); }
    if (!window.cuttingOptimizer) return fail('此介面必須由 Electron 桌面程式開啟。');
    const request = { capacity: validCapacity, threshold: validThreshold, segmentSize: validPitch, orders: orders.map(order => ({ ...order, quantity: Number(order.quantity) })), offcuts: [...offcuts] };
    setBusy(true); clearErrors(); setStatus('C++ 排料引擎正在計算…');
    try {
      const output = sortCuttingResult(await window.cuttingOptimizer.optimise(request));
      setResult(output); setSnapshot({ ...request, key: requestFingerprint(request) });
      setStatus({ key: '完成：只需開 {count} 卷新料', parameters: { count: format(output.summary.newRolls) } });
    } catch (optimiserError) { setError(optimiserError.message); setStatus('計算未完成'); }
    finally { setBusy(false); }
  };

  const exportReport = async () => {
    if (!result || stale || busy || exporting) return;
    setExporting(true);
    try {
      const bytes = createCuttingReport({ ...snapshot, result, language });
      const saved = await window.cuttingOptimizer.saveWorkbook([...new Uint8Array(bytes)], 'cutting-stock-report.xlsx', language);
      if (!saved.canceled) { setStatus({ key: 'Excel 已匯出：{path}', parameters: { path: saved.filePath } }); clearErrors(); }
    } catch (exportError) { setError({ key: 'Excel 匯出失敗：{message}', message: exportError.message }); }
    finally { setExporting(false); }
  };

  const canExample = !orders.length && !offcuts.length && !pasteText.trim();
  const loadExample = () => {
    if (!canExample) return;
    setCapacity(5000); setThreshold(150); setSegmentSize(50);
    setOrders(mergeOrders([], [[1350,43],[1100,42],[1050,114],[800,9],[600,9],[200,33],[150,34]].map(([length,quantity])=>({length,quantity}))));
    setStatus('已載入範例，可開始計算。'); clearErrors();
    setEditorOpen(false);
  };
  const removeOrder = id => { setOrders(current=>current.filter(item=>item.id!==id)); clearErrors(); };
  const focusError = (event, id) => {
    event.preventDefault();
    if (id.startsWith('offcut-')) setInputTab('offcuts');
    else if (id.startsWith('order-') || id.startsWith('quantity-') || id === 'paste-orders') {
      setInputTab('orders');
      if (id.startsWith('order-')) setEntryMode('manual');
      if (id === 'paste-orders') setEntryMode('paste');
      if (!id.startsWith('quantity-')) setEditorOpen(true);
    }
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  };
  const clearList = type => {
    if (!window.confirm(t(type === 'orders' ? '確定清空目前的訂單？' : '確定清空目前的餘料庫存？'))) return;
    if (type === 'orders') setOrders([]); else setOffcuts([]);
    clearErrors();
  };

  return <>
    <a className="skip-link" href="#workspace">{t('跳至工作區')}</a>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Icon name="roll" size={30}/></span><div><h1>{t('卷材裁切優化器')}<span className="version">v{packageInfo.version}</span></h1><p>{t('訂單輸入到每卷裁切，一次看清楚')}</p></div></div>
      <div className="topbar-actions"><label className="language-switch"><span className="sr-only">{t('語言')}</span><select value={language} onChange={event=>setLanguage(event.target.value)} aria-label={t('語言')}><option value="zh">繁體中文</option><option value="en">English</option></select></label>
        <button className="quiet-button export-button" onClick={exportReport} disabled={!result || stale || busy || exporting} title={stale ? t('請重新計算後再匯出') : undefined}><Icon name="download"/>{t(exporting ? '匯出中…' : '匯出 Excel')}</button>
        <button className="primary optimise-button" onClick={optimise} disabled={busy || exporting}>{busy ? <span className="spinner"/> : <Icon name="cut"/>}{t(busy ? '最佳化計算中…' : result ? '重新計算' : '開始最佳化')}</button>
      </div>
    </header>
    <main className="app-shell" id="workspace">
      <section className="settings-strip surface" aria-labelledby="settings-heading"><div className="settings-title"><Icon name="settings" size={21}/><div><h2 id="settings-heading">{t('裁切設定')}</h2><p>{t('節省原料，優先集中可用餘料')}</p></div></div>
        <Field id="stock-capacity" label={t('新卷標準長度')} error={fieldError('stock-capacity')}><input inputMode="numeric" value={capacity} onChange={event=>setCapacity(event.target.value)} disabled={busy || exporting}/></Field>
        <Field id="stock-threshold" label={t('可回收餘料門檻')} error={fieldError('stock-threshold')}><input inputMode="numeric" value={threshold} onChange={event=>setThreshold(event.target.value)} disabled={busy || exporting}/></Field>
        <Field id="stock-pitch" label={t('節距')} error={fieldError('stock-pitch')}><input inputMode="numeric" value={segmentSize} onChange={event=>setSegmentSize(event.target.value)} disabled={busy || exporting}/></Field>
      </section>
      {hasErrors && <div className="error-summary" role="alert" tabIndex="-1" ref={errorSummary}><Icon name="alert"/><div><strong>{t('請檢查輸入內容')}</strong>{Object.entries(fieldErrors).map(([id,message])=><a href={`#${id}`} key={id} onClick={event=>focusError(event,id)}>{t(message)}</a>)}{error && <p>{typeof error === 'string' ? translateError(error,language) : t(error.key,{message:translateError(error.message,language)})}</p>}</div></div>}
      <div className="workspace">
        <aside className="input-column" aria-label={t('訂單與庫存')}>
          <section className="input-panel surface"><div className="input-tabs" role="group" aria-label={t('輸入類別')}>
            <button aria-pressed={inputTab==='orders'} className={inputTab==='orders'?'active':''} onClick={()=>setInputTab('orders')}>{t('客戶訂單')}<span>{orders.length}</span></button>
            <button aria-pressed={inputTab==='offcuts'} className={inputTab==='offcuts'?'active':''} onClick={()=>setInputTab('offcuts')}>{t('餘料庫存')}<span>{offcuts.length}</span></button>
          </div>
          <fieldset disabled={busy || exporting}>
          {inputTab === 'orders' ? <>
            <div className="input-heading"><h2>{t('客戶訂單')}</h2><div>{orders.length>0&&<button className="text-button entry-toggle" aria-expanded={editorOpen} aria-controls="order-editor" onClick={()=>setEditorOpen(current=>!current)}><Icon name={editorOpen?'close':'plus'} size={14}/>{t(editorOpen?'收起輸入':'新增／匯入')}</button>}<button className="text-button" disabled={!orders.length} onClick={()=>clearList('orders')}>{t('清空')}</button></div></div>
            {(editorOpen || !orders.length) && <div id="order-editor">
            <div className="entry-modes" role="group" aria-label={t('新增方式')}><button aria-pressed={entryMode==='paste'} className={entryMode==='paste'?'active':''} onClick={()=>setEntryMode('paste')}>{t('批量貼上')}</button><button aria-pressed={entryMode==='manual'} className={entryMode==='manual'?'active':''} onClick={()=>setEntryMode('manual')}>{t('逐筆新增')}</button></div>
            {entryMode === 'paste' ? <form className="paste-form" onSubmit={event=>{event.preventDefault();if(importRows(textRows(pasteText),'orders'))setPasteText('');}}>
              <Field id="paste-orders" label={t('每行一項：長度,數量')} error={fieldError('paste-orders')}><textarea value={pasteText} onChange={event=>setPasteText(event.target.value)} spellCheck="false" placeholder={'1350,43\n1100,42\n940-20/20,75'}/></Field>
              <div className="import-actions"><button className="secondary" type="submit"><Icon name="plus" size={16}/>{t('加入訂單清單')}</button><button className="quiet-button" type="button" onClick={()=>{setImportMode('orders');fileInput.current?.click();}}><Icon name="upload" size={16}/>{t('匯入檔案')}</button></div>
            </form> : <form className="manual-form" onSubmit={addOrder}>
              <div className="order-entry"><Field id="order-length" label={t('裁切長度／規格')} error={fieldError('order-length')}><input value={orderDraft.length} placeholder="1350 / 160-30/30" onChange={event=>setOrderDraft(current=>({...current,length:event.target.value}))}/></Field><Field id="order-quantity" label={t('數量')} error={fieldError('order-quantity')}><input inputMode="numeric" value={orderDraft.quantity} placeholder="1" onChange={event=>setOrderDraft(current=>({...current,quantity:event.target.value}))}/></Field></div>
              <details className="special-fields" open={fieldErrors['order-start'] || fieldErrors['order-end'] ? true : undefined}><summary>{t('特殊端段（選填）')}</summary><div><Field id="order-start" label={t('起始節段')} error={fieldError('order-start')}><input inputMode="numeric" value={orderDraft.start} onChange={event=>setOrderDraft(current=>({...current,start:event.target.value}))}/></Field><Field id="order-end" label={t('結束節段')} error={fieldError('order-end')}><input inputMode="numeric" value={orderDraft.end} onChange={event=>setOrderDraft(current=>({...current,end:event.target.value}))}/></Field></div></details>
              <button className="secondary add-order" type="submit"><Icon name="plus" size={16}/>{t('新增訂單')}</button>
            </form>}
            <p className="input-hint">{t('支援特殊規格 160-30/30；端段只在卷材中間對接。')}</p>
            </div>}
            <div className="orders-table-scroll"><table className="orders-table"><thead><tr><th scope="col">{t('規格')}</th><th scope="col">{t('數量')}</th><th scope="col">{t('小計')}</th><th scope="col"><span className="sr-only">{t('移除')}</span></th></tr></thead><tbody>{orders.map(item=><tr key={item.id}><td>{displaySpecification(item)}</td><td><input className="quantity-input" id={`quantity-${item.id}`} type="number" min="1" value={item.quantity} aria-label={t('{spec} 的數量',{spec:displaySpecification(item)})} aria-invalid={fieldErrors[`quantity-${item.id}`]?true:undefined} onChange={event=>setOrders(current=>current.map(order=>order.id===item.id?{...order,quantity:event.target.value}:order))}/>{fieldError(`quantity-${item.id}`)&&<small className="field-error">{fieldError(`quantity-${item.id}`)}</small>}</td><td>{format(item.length*Number(item.quantity||0))}</td><td><button className="icon-button remove-button" aria-label={t('移除 {spec}',{spec:displaySpecification(item)})} onClick={()=>removeOrder(item.id)}><Icon name="close" size={14}/></button></td></tr>)}</tbody></table>{!orders.length&&<div className="empty-orders"><Icon name="layers" size={22}/><p>{t('尚未加入訂單')}</p><span>{t('貼上清單，或切換至逐筆新增')}</span></div>}</div>
            <footer className="input-totals"><span>{t('共 {count} 件',{count:format(itemCount)})}</span><span>{t('總長')} <strong>{format(orderLength)}</strong></span></footer>
          </> : <>
            <div className="input-heading"><h2>{t('現有餘料庫存')}</h2><button className="text-button" disabled={!offcuts.length} onClick={()=>clearList('offcuts')}>{t('清空')}</button></div><p className="inventory-note">{t('優先消耗，未使用段會保留為庫存')}</p>
            <form onSubmit={addOffcut} className="offcut-form"><Field id="offcut-length" label={t('餘料長度')} error={fieldError('offcut-length')}><input inputMode="numeric" value={offcutDraft} placeholder="1500" onChange={event=>setOffcutDraft(event.target.value)}/></Field><Field id="offcut-quantity" label={t('數量')} error={fieldError('offcut-quantity')}><input inputMode="numeric" value={offcutQuantity} onChange={event=>setOffcutQuantity(event.target.value)}/></Field><button className="secondary" type="submit"><Icon name="plus" size={16}/>{t('加入餘料')}</button></form>
            <button className="quiet-button inventory-import" onClick={()=>{setImportMode('offcuts');fileInput.current?.click();}}><Icon name="upload" size={16}/>{t('匯入餘料檔')}</button><p className="input-hint">{t('每行一段，或使用 Excel 第一欄')}</p>
            <div className="offcut-list">{offcuts.map((length,index)=><div key={`${length}-${index}`}><Icon name="roll" size={16}/><strong>{format(length)}</strong><button className="icon-button remove-button" aria-label={t('移除餘料 {length}',{length:format(length)})} onClick={()=>setOffcuts(current=>current.filter((_,itemIndex)=>itemIndex!==index))}><Icon name="close" size={14}/></button></div>)}{!offcuts.length&&<p className="empty-orders">{t('沒有可用餘料')}</p>}</div><footer className="input-totals"><span>{t('共 {count} 段',{count:format(offcuts.length)})}</span><span>{t('總長')} <strong>{format(offcutLength)}</strong></span></footer>
          </>}
          </fieldset></section>
          <div className="engine-status" role="status" aria-live="polite" title={statusText}><span className={busy?'status-dot working':'status-dot'}/><span>{statusText}</span></div>
        </aside>
        {result && snapshot ? <ResultsWorkspace key={snapshot.key} result={result} snapshot={snapshot} t={t} stale={stale} busy={busy} onOptimise={optimise}/> : <EmptyPlan t={t} hasOrders={Boolean(orders.length)} busy={busy} onOptimise={optimise} onExample={loadExample} canExample={canExample}/>}
      </div>
      <input ref={fileInput} className="hidden" type="file" accept=".txt,.csv,.xlsx" onChange={importFile} aria-label={t('匯入檔案')}/>
      <footer className="app-footer"><span>{t('本機運算，訂單資料不會上傳')}</span><span>{t('React 介面 · C++ 原生排料引擎')}</span></footer>
    </main>
  </>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
