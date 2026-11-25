import React, { useMemo, useState } from 'react';
import { createLengthColours, cutInstruction, entryMatches, formatLength as format, groupRolls, materialSummary, physicalSegments, rollEntries, rollNumbers, specificationLabel } from './planPresentation';

export function Icon({ name, size = 18, className = '' }) {
  const paths = {
    roll: <><circle cx="9" cy="10" r="6"/><circle cx="9" cy="10" r="2"/><path d="M9 16h11v-6h-5M20 16v4M16 16v2M12 16v4M8 16v2"/></>,
    cut: <><circle cx="5" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><path d="m7 8 13 12M7 16 20 4M11 12l-3 3"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
    download: <><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    arrow: <path d="m9 5 7 7-7 7"/>,
    back: <path d="m15 5-7 7 7 7"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
    alert: <><path d="m12 3 10 17H2L12 3Z"/><path d="M12 9v4m0 3h.01"/></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/></>,
    grid: <><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="11" height="6" rx="1.5"/><path d="M7 4v6m5-6v6m5 4h4v6h-4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>{paths[name] || paths.roll}</svg>;
}

export function Field({ id, label, error, hint, children, className = '' }) {
  return <div className={`field ${className}`}>
    <label htmlFor={id}>{label}</label>
    {React.cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined })}
    {hint && <small id={`${id}-hint`} className="field-hint">{hint}</small>}
    {error && <small id={`${id}-error`} className="field-error">{error}</small>}
  </div>;
}

export function EmptyPlan({ t, hasOrders, busy, onOptimise, onExample, canExample }) {
  return <section className="empty-plan surface" aria-labelledby="empty-plan-title">
    <div className="empty-plan-art" aria-hidden="true"><div className="ruler-line"/><div className="demo-cuts"><span/><span/><span/><i/></div><div className="demo-cuts second"><span/><span/><i/></div></div>
    <h2 id="empty-plan-title">{t('裁切方案會顯示在這裡')}</h2>
    <p>{t('輸入訂單並開始計算，即可查看每卷裁切順序、碎料及可回用餘料。')}</p>
    {hasOrders ? <button className="primary" disabled={busy} onClick={onOptimise}><Icon name="cut"/>{t('開始最佳化')}</button>
      : canExample && <button className="quiet-button" disabled={busy} onClick={onExample}>{t('載入範例訂單')}<Icon name="arrow" size={16}/></button>}
    <div className="empty-plan-note"><Icon name="check" size={16}/>{t('保留每段裁切長度，餘料也清楚列出')}</div>
  </section>;
}

function Pagination({ total, page, pageSize, onPage, t }) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return <div className="pagination"><span>{t('第 {page} / {pages} 頁', { page: page + 1, pages })}</span><div>
    <button className="quiet-button" aria-label={t('上一頁')} disabled={page === 0} onClick={() => onPage(page - 1)}><Icon name="back" size={16}/></button>
    <button className="quiet-button" aria-label={t('下一頁')} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}><Icon name="arrow" size={16}/></button>
  </div></div>;
}

function MaterialOverview({ result, threshold, t }) {
  const material = materialSummary(result, threshold);
  const percent = Number(material.productPercent.toFixed(1));
  return <section className="result-overview surface" aria-labelledby="result-heading">
    <div className="result-heading"><h2 id="result-heading">{t('本次裁切方案')}</h2><div className="result-heading-meta"><span className="complete-label"><Icon name="check" size={14}/>{t('排料已完成')}</span><span className="result-piece-count">{t('共 {count} 件成品', { count: format(result.summary.itemCount) })}</span></div></div>
    <div className="result-numbers">
      <div className="roll-total"><span>{t('需開新卷')}</span><strong>{format(result.summary.newRolls)}<small>{t('卷', { count: result.summary.newRolls })}</small></strong><span>{t('已用既有餘料 {count} 段', { count: format(result.summary.offcutsUsed) })}</span></div>
      <div className="material-stat"><span>{t('不可回收碎料')}</span><strong>{format(material.scrap)}</strong><small className={material.scrap === 0 ? 'positive-note' : ''}>{material.scrap === 0 ? t('沒有不可回收碎料') : t('{count} 段', { count: format(result.summary.deadScrapCount) })}</small></div>
      <div className="material-stat reusable-stat"><span>{t('可回用餘料')}</span><strong>{format(material.reusable)}</strong><small>{t('共 {count} 段', { count: format(material.tailCount) })}</small></div>
      <div className="material-stat"><span>{t('最長可回用餘料')}</span><strong>{format(material.longestTail)}</strong><small>{t('門檻 ≥ {length}', { length: format(threshold) })}</small></div>
    </div>
    <div className="material-balance">
      <div className="balance-heading"><span>{t('原料分配')}</span><strong>{t('成品佔比 {percent}%', { percent })}</strong></div>
      <div className="material-bar" role="img" aria-label={t('成品 {product}、可回用餘料 {reusable}、碎料 {scrap}', { product: format(material.product), reusable: format(material.reusable), scrap: format(material.scrap) })}>
        {[['product', material.product], ['reusable', material.reusable], ['scrap', material.scrap]].map(([kind, value]) => <span key={kind} className={kind} style={{ width: `${material.stock ? value / material.stock * 100 : 0}%` }}/>)}</div>
      <div className="balance-legend"><span><i className="product"/>{t('成品')} {format(material.product)}</span><span><i className="reusable"/>{t('可回用')} {format(material.reusable)}</span><span><i className="scrap"/>{t('碎料')} {format(material.scrap)}</span><span className="balance-total">{t('已開原料合計 {length}', { length: format(material.stock) })}</span></div>
    </div>
  </section>;
}

function CuttingGroup({ group, orders, threshold, tones, t }) {
  const { bin, source, indices } = group;
  return <article className="cutting-group">
    <div className="cutting-group-heading"><div><span className="source-icon"><Icon name={source === 'new' ? 'roll' : 'layers'} size={17}/></span><h3>{t(source === 'new' ? '新卷' : '餘料')} <span>{rollNumbers(indices)}</span></h3>{indices.length > 1 && <span className="repeat-label">{t(source === 'new' ? '{count} 卷同配方' : '{count} 段同配方', { count: format(indices.length) })}</span>}</div><span className="stock-measure">{t('原料 {length}', { length: format(bin.capacity) })}</span></div>
    <div className="cut-cells" aria-label={t('實際裁切順序')}>
      {physicalSegments(bin).map((segment, index) => <div key={index} className={`cut-cell ${segment.kind === 'edgeScrap' ? 'end-filler' : 'product-cell'}`} style={segment.kind === 'edgeScrap' ? undefined : {backgroundColor:tones.get(segment.length)?.fill,color:tones.get(segment.length)?.text}} title={segment.kind === 'edgeScrap' ? t('端段補位') : orders.filter(order=>order.length===segment.length).length === 1 ? specificationLabel(orders.find(order=>order.length===segment.length)) : format(segment.length)}>
        <span>{t(segment.kind === 'edgeScrap' ? '補位' : '裁切')}</span><strong>{format(segment.length)}</strong>
      </div>)}
      {bin.remainder > 0 && <div className={`cut-cell remainder-cell ${bin.remainder < threshold ? 'small-remainder' : ''}`}><span>{t(bin.remainder >= threshold ? '可回用餘料' : '不可回收碎料')}</span><strong>{format(bin.remainder)}</strong></div>}
    </div>
    <div className="cutting-group-foot"><p>{cutInstruction(bin.items, orders)}</p><span>{bin.edgeScrap > 0 ? t('端段碎料 {length}', { length: format(bin.edgeScrap) }) : !bin.remainder ? <><Icon name="check" size={14}/>{t('完美使用')}</> : t('已用 {length}', { length: format(bin.used) })}</span></div>
  </article>;
}

function RollTable({ entries, threshold, orders, t }) {
  return <div className="table-scroll" tabIndex="0" aria-label={t('逐卷裁切明細')}><table className="result-table"><thead><tr><th scope="col">{t('來源')}</th><th scope="col">{t('裁切項目')}</th><th scope="col">{t('實體已用')}</th><th scope="col">{t('實體剩餘')}</th><th scope="col">{t('狀態')}</th></tr></thead><tbody>{entries.map(({ bin, index, source, key }) => {
    const state = !bin.used ? '保留庫存' : !bin.remainder ? bin.edgeScrap > 0 ? '用滿（含端段碎料）' : '完美使用' : bin.remainder >= threshold ? '可回收' : '不可回收碎料';
    return <tr key={key}><td><span className="table-source">{t(source === 'new' ? '新卷' : '餘料')} #{index + 1}</span><small>{format(bin.capacity)}</small></td><td><span className="cut-instruction">{cutInstruction(bin.items, orders)}</span>{bin.layoutSegments?.length > 0 && <details className="physical-detail"><summary>{t('實際裁切順序')}</summary><p>{physicalSegments(bin).map(segment => segment.kind === 'edgeScrap' ? t('{length}（端段補位）', { length: format(segment.length) }) : format(segment.length)).join(' → ')}</p></details>}{bin.edgeScrap > 0 && <small className="edge-note">{t('端段碎料 {length}', { length: format(bin.edgeScrap) })}</small>}</td><td>{format(bin.used)}</td><td className={bin.used && bin.remainder >= threshold && bin.remainder > 0 ? 'reusable-value' : ''}>{format(bin.remainder)}</td><td><span className={`state ${state === '不可回收碎料' ? 'scrap' : state === '可回收' ? 'reusable' : ''}`}>{t(state)}</span></td></tr>;
  })}</tbody></table></div>;
}

export function ResultsWorkspace({ result, snapshot, t, stale, busy, onOptimise }) {
  const [view, setView] = useState('visual');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const { threshold, orders } = snapshot;
  const allEntries = useMemo(() => rollEntries(result, true), [result]);
  const activeEntries = useMemo(() => allEntries.filter(entry => entry.bin.used), [allEntries]);
  const sourceEntries = useMemo(() => view === 'inventory' ? allEntries.filter(entry => entry.source === 'offcut') : view === 'table' ? allEntries.filter(entry=>entry.source === 'new') : activeEntries, [view,allEntries,activeEntries]);
  const filtered = useMemo(() => sourceEntries.filter(entry => entryMatches(entry, filter, query, threshold)), [sourceEntries, filter, query, threshold]);
  const groups = useMemo(() => groupRolls(filtered), [filtered]);
  const tones = useMemo(() => createLengthColours(orders), [orders]);
  const pageSize = view === 'visual' ? 10 : 25;
  const total = view === 'visual' ? groups.length : filtered.length;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
  const switchView = value => { setView(value); setFilter('all'); setQuery(''); setPage(0); };
  return <section className="results-workspace" aria-label={t('最佳化結果')} aria-busy={busy}>
    {stale && <div className="stale-notice" role="status"><Icon name="alert"/><div><strong>{t('輸入已變更')}</strong><p>{t('下方是上次的計算結果。請重新計算後再匯出。')}</p></div><button className="quiet-button" disabled={busy} onClick={onOptimise}>{t('重新計算')}</button></div>}
    <MaterialOverview result={result} threshold={threshold} t={t}/>
    <section className="plan-panel surface">
      <div className="plan-tabs" role="group" aria-label={t('排料檢視')}>
        {[['visual','視覺排料','grid'],['table','逐卷明細','table'],['inventory','餘料使用','layers']].map(([value,label,icon]) => <button key={value} aria-pressed={view === value} className={view === value ? 'active' : ''} onClick={()=>switchView(value)}><Icon name={icon} size={17}/>{t(label)}{value === 'inventory' && <span>{(result.productOffcuts || result.offcuts).length}</span>}</button>)}
      </div>
      <div className="plan-toolbar"><div className="plan-filters" role="group" aria-label={t('篩選排料')}>
        {[['all','全部'],['remainder','有餘料'],['full','用滿'],['scrap','含碎料']].map(([value,label])=><button key={value} aria-pressed={filter===value} className={filter===value?'selected':''} onClick={()=>{setFilter(value);setPage(0);}}>{t(label)}{value==='remainder'&&<span>{sourceEntries.filter(entry=>entry.bin.used&&entry.bin.remainder>0).length}</span>}</button>)}
      </div><label className="plan-search"><Icon name="search" size={16}/><span className="sr-only">{t('搜尋排料')}</span><input value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}} placeholder={t('長度或 #卷號')} type="search"/></label></div>
      <div className="plan-meta"><span>{view === 'visual' ? t('{rolls} 段原料，{groups} 種裁切配方', { rolls: format(filtered.length), groups: format(groups.length) }) : t(view === 'inventory' ? '共 {count} 段' : '共 {count} 卷', { count: format(filtered.length) })}</span>{view === 'visual' && <span>{t('每格一段，非長度比例')}</span>}</div>
      {!filtered.length ? <div className="no-matches"><Icon name="search" size={24}/><p>{t(view === 'inventory' && !sourceEntries.length ? '沒有使用既有餘料' : '沒有符合條件的排料')}</p><small>{t(view === 'inventory' && !sourceEntries.length ? '可在左側加入餘料，重新計算時一併使用。' : '試試其他長度，或切換回全部。')}</small></div>
        : view === 'visual' ? <div className="cutting-groups">{groups.slice(currentPage*pageSize,(currentPage+1)*pageSize).map(group=><CuttingGroup key={group.key} group={group} orders={orders} threshold={threshold} tones={tones} t={t}/>)}</div>
          : <RollTable entries={filtered.slice(currentPage*pageSize,(currentPage+1)*pageSize)} threshold={threshold} orders={orders} t={t}/>}
      <Pagination total={total} page={currentPage} pageSize={pageSize} onPage={setPage} t={t}/>
    </section>
    {result.sectionPlan && <details className="pitch-details surface"><summary><span><Icon name="layers"/>{t('節距中段對接計畫')}</span><span>{t('已對接 {count} 節', { count: format(result.sectionPlan.pairedSections) })}</span></summary><div><p>{t('只有卷材中間的 {pitch} 節距可做端段對接；第一與最後一節不參與。', { pitch: format(result.sectionPlan.segmentSize) })}</p><div className="pair-lines">{result.sectionPlan.pairs.map((pair,index)=><span key={index}>{pair.left} + {pair.right} = {result.sectionPlan.segmentSize} × {format(pair.count)}</span>)}</div>{!!result.sectionPlan.unpaired.length && <p className="edge-note">{t('未配對：')}{result.sectionPlan.unpaired.map(item=>t('{value} × {count}（浪費 {waste}）',item)).join(', ')}</p>}</div></details>}
  </section>;
}
