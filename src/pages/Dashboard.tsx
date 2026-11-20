import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowDownToLine, ArrowUpRight, Check, Search, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useStore, stockStatus, isPayrollPayment, type State } from '../../store'
import { computeReport, presetRange, key as dateKey } from '../../report'
import { useLang } from '../../i18n'
import RecordButton from '../../components/RecordButton'
import ImportButton from '../../components/ImportButton'

const heading = { fontFamily: 'Bricolage Grotesque, sans-serif' }
const card = 'rounded-2xl bg-white p-6 shadow-sm'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const fmt2 = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
const pct = (v: number | null) => (v === null ? '' : `${Math.round(v * 100)}%`)

// Status values stay in English in the code; only the label shown is translated
const finderStatus = {
  'In stock': { key: 'stock.inStock', cls: 'bg-[#1F6B45]/15 text-[#1F6B45]' },
  Reorder: { key: 'stock.lowStock', cls: 'bg-[#F2B632] text-[#14251C]' },
  'Out of stock': { key: 'stock.outOfStock', cls: 'bg-[#E4572E] text-white' },
} as const

// A big number that never wraps or overflows: its size follows the width of the card it is in
// (container query units), so it fits on phones and computers, even with 8 or 9 digits.
function BigNumber({ value, unit, size = 'md', className = '' }: { value: string; unit?: string; size?: 'md' | 'lg'; className?: string }) {
  const fontSize = size === 'lg' ? 'clamp(1.75rem, 12cqw, 3.25rem)' : 'clamp(1.25rem, 12cqw, 1.875rem)'
  return (
    <div style={{ containerType: 'inline-size' }}>
      <p
        className={`whitespace-nowrap font-extrabold leading-tight ${size === 'lg' ? 'text-4xl' : 'text-3xl'} ${className}`}
        style={{ ...heading, fontSize }}
      >
        {value}
        {unit && <span className="ml-1.5 text-[0.55em]">{unit}</span>}
      </p>
    </div>
  )
}

/* ---------- Everything on this page is worked out here from the store ----------
   This part holds no text: chart labels and the month name are made in the page below,
   from dates, so they follow the language the user has chosen. */

function compute(state: State) {
  const { products, sales } = state
  const now = new Date()
  const key = (d: Date) => d.toLocaleDateString('en-CA') // YYYY-MM-DD, local time
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
  const monthStart = (offset: number) => new Date(now.getFullYear(), now.getMonth() - offset, 1)
  const thisMonth = key(monthStart(0)).slice(0, 7)
  const lastMonth = key(monthStart(1)).slice(0, 7)

  const salesThisMonth = sales.filter((s) => s.date.startsWith(thisMonth))
  const revenue = salesThisMonth.reduce((t, s) => t + s.total, 0)
  const orders = salesThisMonth.length
  const lastOrders = sales.filter((s) => s.date.startsWith(lastMonth)).length

  const daily = Array.from({ length: 7 }, (_, i) => {
    const d = day(6 - i)
    return { date: d, value: sales.filter((s) => s.date === key(d)).reduce((t, s) => t + s.total, 0) }
  })
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = monthStart(11 - i)
    const k = key(d).slice(0, 7)
    return { date: d, value: sales.filter((s) => s.date.startsWith(k)).reduce((t, s) => t + s.total, 0) }
  })

  const valuation = products.reduce((t, p) => t + Math.max(0, p.stock) * p.cost, 0)
  const counts = {
    inStock: products.filter((p) => stockStatus(p) === 'In stock').length,
    low: products.filter((p) => stockStatus(p) === 'Reorder').length,
    out: products.filter((p) => stockStatus(p) === 'Out of stock').length,
  }
  // Dead stock: you have it on the shelf, but it has not sold for 90 days
  const since90 = key(day(89))
  const soldRecently = new Set(sales.filter((s) => s.date >= since90).flatMap((s) => s.lines.map((l) => l.productId).filter(Boolean)))
  const dead = products.filter((p) => p.stock > 0 && !soldRecently.has(p.id)).length

  const reorder = products
    .filter((p) => stockStatus(p) !== 'In stock')
    .sort((a, b) => (a.stock <= 0 ? -1 : 0) - (b.stock <= 0 ? -1 : 0) || a.stock / (a.reorder || 1) - b.stock / (b.reorder || 1))

  // Top sellers over the last 30 days
  const since30 = key(day(29))
  const sold = new Map<string, { units: number; revenue: number }>()
  sales
    .filter((s) => s.date >= since30)
    .forEach((s) =>
      s.lines.filter((l) => l.productId).forEach((l) => {
        const cur = sold.get(l.productId) ?? { units: 0, revenue: 0 }
        sold.set(l.productId, { units: cur.units + l.qty, revenue: cur.revenue + l.qty * l.price })
      }),
    )
  const topSelling = products
    .filter((p) => sold.has(p.id))
    .map((p) => ({ name: p.name, ...sold.get(p.id)! }))

  // Profit, collections and balances use the same calculations as the Reports page, so the numbers always agree
  const report = computeReport(state, presetRange('month'))
  const aging = report.balances.aging
  const overdue = aging[1] + aging[2] + aging[3] // unpaid invoices older than 30 days

  return { now, revenue, orders, lastOrders, daily, monthly, valuation, counts, dead, reorder, topSelling, report, overdue }
}

// What the user chose on the Get started card. Saved in this browser only, per business name.
type StartPrefs = { hidden: boolean; noCustomers: boolean }
const noPrefs: StartPrefs = { hidden: false, noCustomers: false }

export default function Dashboard() {
  const { state, loading, error } = useStore()
  const { t, lang } = useLang()
  // 'Week' and 'Month' are internal values. Only the labels shown are translated.
  const [range, setRange] = useState<'Week' | 'Month'>('Week')
  const [metric, setMetric] = useState<'units' | 'revenue'>('units')
  const [hoverBar, setHoverBar] = useState<number | null>(null) // bar showing its amount

  // Quick product finder
  const [search, setSearch] = useState('')
  const [finderOpen, setFinderOpen] = useState(false)
  const finderRef = useRef<HTMLDivElement>(null)
  const [packs, setPacks] = useState<Record<string, { name: string; size: number }>>({})

  // "Get started" checklist: hidden by the user, or step 2 skipped
  const startKey = `ekayi.start.v1.${state.businessName}`
  const [startPrefs, setStartPrefs] = useState<StartPrefs>(noPrefs)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(startKey)
      setStartPrefs(raw ? { ...noPrefs, ...JSON.parse(raw) } : noPrefs)
    } catch {
      setStartPrefs(noPrefs) // storage not available: the card simply shows
    }
  }, [startKey])
  const updateStartPrefs = (patch: Partial<StartPrefs>) => {
    const next = { ...startPrefs, ...patch }
    setStartPrefs(next)
    try {
      localStorage.setItem(startKey, JSON.stringify(next))
    } catch {
      /* storage not available: the choice lasts until the page is reloaded */
    }
  }

  // Pack details come straight from the products table, the same columns the Products page saves
  useEffect(() => {
    let cancelled = false
    supabase
      .from('products')
      .select('id, pack_name, pack_size')
      .then(({ data }) => {
        if (cancelled) return
        const map: Record<string, { name: string; size: number }> = {}
        ;((data ?? []) as { id: string; pack_name: string | null; pack_size: number | null }[]).forEach((r) => {
          if (r.pack_name && Number(r.pack_size) > 0) map[r.id] = { name: r.pack_name, size: Number(r.pack_size) }
        })
        setPacks(map)
      })
    return () => { cancelled = true }
  }, [state.products])

  // Close the dropdown when you click elsewhere or press Escape
  useEffect(() => {
    if (!finderOpen) return
    const onDown = (e: MouseEvent) => {
      if (finderRef.current && !finderRef.current.contains(e.target as Node)) setFinderOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFinderOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [finderOpen])

  const unitLabel = (u: string) => {
    const k = `unit.${u}`
    const v = t(k)
    return v === k ? u : v // old or custom units show as saved
  }
  // English plural for pack names (Bag -> Bags). Kinyarwanda names show as they are.
  const plural = (w: string) => (lang === 'en' ? (/(s|x|ch|sh)$/i.test(w) ? `${w}es` : `${w}s`) : w)

  const d = useMemo(() => compute(state), [state])
  const { pl, cash, balances } = d.report

  const q = search.trim().toLowerCase()
  const matches = q ? state.products.filter((p) => p.name.toLowerCase().includes(q)) : []
  // "875 Kg", or for a pack product "17.5 Bags · 875 Kg"
  const stockText = (p: (typeof state.products)[number]) => {
    const n = Math.max(0, p.stock)
    const small = `${fmt2(n)} ${unitLabel(p.unit)}`
    const pk = packs[p.id]
    return pk ? `${fmt2(n / pk.size)} ${plural(unitLabel(pk.name))} · ${small}` : small
  }

  // Month and chart labels, in the chosen language
  const monthName = `${t(`date.month.${d.now.getMonth() + 1}`)} ${d.now.getFullYear()}`
  const dayLabel = (date: Date) => t(`date.dow.${date.getDay()}`)
  const monthLabel = (date: Date) => t(`date.monthShort.${date.getMonth() + 1}`)

  const bars = (range === 'Week' ? d.daily : d.monthly).map((b) => ({
    label: range === 'Week' ? dayLabel(b.date) : monthLabel(b.date),
    // longer name for the tooltip: "Sat 24 Oct" or "October 2026"
    full:
      range === 'Week'
        ? `${dayLabel(b.date)} ${b.date.getDate()} ${monthLabel(b.date)}`
        : `${t(`date.month.${b.date.getMonth() + 1}`)} ${b.date.getFullYear()}`,
    value: b.value,
  }))
  const barMax = Math.max(...bars.map((b) => b.value))
  const barTotal = bars.reduce((tot, b) => tot + b.value, 0)

  const ranked = [...d.topSelling].sort((x, y) => y[metric] - x[metric]).slice(0, 5)
  const rankMax = ranked[0]?.[metric] || 1
  const reorderShown = d.reorder
  const orderChange = d.lastOrders > 0 ? Math.round(((d.orders - d.lastOrders) / d.lastOrders) * 100) : null
  const collectedShare = pl.revenue > 0 ? Math.min(100, (cash.collected / pl.revenue) * 100) : 0


  // Shows English until a translation exists
  const tx = (k: string, fallback: string, p?: Record<string, string | number>) => {
    const v = t(k, p)
    return v === k ? fallback.replace(/\{(\w+)\}/g, (_, n) => String(p?.[n] ?? '')) : v
  }

  // ----- Needs attention: things the owner should act on, most urgent first -----
  const salariesOwed = state.accrualsOn
    ? Math.max(
        0,
        (state.payrollAccruals ?? []).filter((a) => a.ym < dateKey(d.now).slice(0, 7)).reduce((tot, a) => tot + a.amount, 0) - // finished months only
         
          state.expenses.filter(isPayrollPayment).reduce((tot, e) => tot + e.amount, 0),
      )
    : 0
  const attention: { id: string; level: 'warn' | 'info'; title: string; detail: string; to: string }[] = []
  if (d.overdue > 0)
    attention.push({ id: 'overdue', level: 'warn', title: tx('dash.att.overdue', 'Customers are late paying you'), detail: t('dash.olderThan30', { amount: `${fmt(d.overdue)} RWF` }), to: '/app/customers' })
  if (d.counts.out > 0)
    attention.push({ id: 'out', level: 'warn', title: tx('dash.att.out', '{n} item(s) out of stock', { n: d.counts.out }), detail: tx('dash.att.outHint', 'Buy or make more'), to: '/app/inventory' })
  if (salariesOwed > 0)
    attention.push({ id: 'salaries', level: 'warn', title: tx('dash.att.salaries', 'Salaries not yet paid'), detail: `${fmt(salariesOwed)} RWF`, to: '/app/payroll' })
  if (balances.payables > 0)
    attention.push({ id: 'payables', level: 'info', title: tx('dash.att.suppliers', 'You owe suppliers'), detail: `${fmt(balances.payables)} RWF`, to: '/app/suppliers' })
  if (d.counts.low > 0)
    attention.push({ id: 'low', level: 'info', title: tx('dash.att.low', '{n} item(s) running low', { n: d.counts.low }), detail: tx('dash.att.lowHint', 'Below their reorder level'), to: '/app/inventory' })
  if (d.dead > 0)
    attention.push({ id: 'dead', level: 'info', title: tx('dash.att.dead', '{n} item(s) have not sold for 90 days', { n: d.dead }), detail: tx('dash.att.deadHint', 'Money sitting on the shelf'), to: '/app/inventory' })

  // ----- Recent activity: the latest things recorded, all kinds together -----
  const custName = new Map(state.customers.map((c) => [c.id, c.name]))
  const supName = new Map(state.suppliers.map((x) => [x.id, x.name]))
  const activity = [
    ...state.sales.map((x) => ({ id: `s${x.id}`, date: x.date, in: true, label: tx('record.sold', 'Sale'), who: (x.customerId && custName.get(x.customerId)) || x.invoice, amount: x.total })),
    ...state.purchases.map((x) => ({ id: `p${x.id}`, date: x.date, in: false, label: tx('record.bought', 'Purchase'), who: (x.supplierId && supName.get(x.supplierId)) || x.ref, amount: x.total })),
    ...state.expenses.filter((x) => !isPayrollPayment(x)).map((x) => ({ id: `e${x.id}`, date: x.date, in: false, label: tx('record.spent', 'Expense'), who: x.description, amount: x.amount })),
    ...(state.otherIncome ?? []).map((x) => ({ id: `o${x.id}`, date: x.date, in: true, label: tx('record.other', 'Other income'), who: x.note || x.category, amount: x.amount })),
    ...(state.ownerMoves ?? []).map((x) => ({ id: `m${x.id}`, date: x.date, in: x.kind === 'in', label: x.kind === 'in' ? tx('record.ownerIn', 'Owner money in') : tx('record.ownerOut', 'Owner money out'), who: x.note, amount: x.amount })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 8)

  // ----- Income vs expenses, last 6 months (same calculations as Reports) -----
  const monthly6 = Array.from({ length: 6 }, (_, i) => {
    const m = new Date(d.now.getFullYear(), d.now.getMonth() - (5 - i), 1)
    const r = computeReport(state, { from: dateKey(m), to: dateKey(new Date(m.getFullYear(), m.getMonth() + 1, 0)) }).pl
    return { label: monthLabel(m), income: r.revenue + r.otherIncome, expenses: r.totalExpenses }
  })
  const chartMax = Math.max(1, ...monthly6.flatMap((m) => [m.income, m.expenses]))
  const chartHas = monthly6.some((m) => m.income > 0 || m.expenses > 0)

  const tiles = [
    { id: 'in', label: t('stock.inStock'), n: d.counts.inStock, cls: 'bg-[#1F6B45] text-white' },
    { id: 'low', label: t('stock.lowStock'), n: d.counts.low, cls: 'bg-[#F2B632] text-[#14251C]' },
    { id: 'out', label: t('stock.outOfStock'), n: d.counts.out, cls: 'bg-[#E4572E] text-white' },
    { id: 'dead', label: t('stock.deadStock'), n: d.dead, cls: 'bg-[#DDE5DF] text-[#14251C]', hint: t('dash.deadHint') },
  ]

  // Get started checklist: each step opens a page you already have.
  // Step 2 is optional, so it counts as done once skipped.
  const startSteps = [
    { id: 's1', done: state.products.length > 0, to: '/app/inventory', optional: false },
    { id: 's2', done: state.customers.length > 0 || startPrefs.noCustomers, to: '/app/customers', optional: true },
    { id: 's3', done: state.sales.length > 0, to: '/app/sales', optional: false },
  ]
  // Step 2 uses the new wording; steps 1 and 3 keep their existing texts
  const stepTitle = (id: string) => (id === 's2' ? t('start.owe.title') : t(`start.${id}.title`))
  const stepText = (id: string) =>
    id === 's2' ? t('start.owe.text')
    : id === 's1' && state.businessType === 'small_factory' ? t('start.factory.s1.text')
    : t(`start.${id}.text`)
  const stepBtn = (id: string) => (id === 's2' ? t('start.owe.btn') : t(`start.${id}.btn`))

  const startDone = startSteps.filter((s) => s.done).length
  // The first required step opens first, so an optional step never blocks the first sale
  const nextStep = startSteps.find((s) => !s.done && !s.optional) ?? startSteps.find((s) => !s.done)
  const showStart = !loading && !error && !startPrefs.hidden && startDone < startSteps.length
  const startProgress = t('start.progress', { done: startDone, total: startSteps.length })

  // A brand-new business: no products yet. Show a welcome and hide the zeros until the first product exists.
  const isEmpty = !loading && !error && state.products.length === 0
  const showContent = !loading && !error && !isEmpty

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={heading}>{isEmpty ? (state.businessName ? t('dash.welcomeName', { name: state.businessName }) : t('dash.welcome')) : t('dash.title')}</h1>
          <p className="mt-1 text-[#3d5246]">{state.businessName || t('dash.yourBusiness')} · {loading ? t('dash.loading') : monthName}</p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <RecordButton inline />
          <ImportButton />
        {/* Quick finder: type a product to see its stock, unit and status. Nothing to find yet when there are no products. */}
        {showContent && (
        <div ref={finderRef} className="relative w-full sm:w-80">
          <label className="relative block">
            <Search className="absolute left-3 top-3 h-4 w-4 text-[#3d5246]" aria-hidden />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setFinderOpen(true) }}
              onFocus={() => setFinderOpen(true)}
              placeholder={t('dash.searchProducts')}
              aria-label={t('dash.searchAria')}
              aria-expanded={finderOpen && q !== ''}
              aria-controls="finder-results"
              autoComplete="off"
              className="w-full rounded-full border border-[#14251C]/15 bg-white py-2.5 pl-9 pr-4 outline-none focus:border-[#1F6B45]"
            />
          </label>

          {finderOpen && q !== '' && (
            <div id="finder-results" className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-[#14251C]/10">
              {matches.length === 0 ? (
                <p className="px-4 py-4 text-sm text-[#3d5246]">{t('dash.finder.none')}</p>
              ) : (
                <>
                  <ul className="max-h-80 divide-y divide-[#14251C]/10 overflow-y-auto">
                    {matches.slice(0, 6).map((p) => {
                      const st = finderStatus[stockStatus(p) as keyof typeof finderStatus]
                      return (
                        <li key={p.id}>
                          <Link
                            to="/app/inventory"
                            onClick={() => setFinderOpen(false)}
                            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#F3F7F4]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{p.name}</p>
                              <p className="text-xs text-[#3d5246]">{stockText(p)}</p>
                            </div>
                            <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>
                              {t(st.key)}
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                  <Link
                    to="/app/inventory"
                    onClick={() => setFinderOpen(false)}
                    className="block border-t border-[#14251C]/10 bg-[#F3F7F4] px-4 py-2.5 text-center text-sm font-semibold text-[#1F6B45] hover:underline"
                  >
                    {matches.length > 6 ? t('dash.finder.more', { n: matches.length }) : t('dash.finder.open')}
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
        )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {t('common.loadError', { error })}
        </p>
      )}

      {/* Get started: three steps for a new business. Only the current step is open; the others are one line.
          Disappears when all are done, or when hidden. */}
      {showStart && (
        <section className={`${card} border-2 border-[#F2B632]/60 !p-5`} aria-labelledby="start-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="start-title" className="text-xl font-extrabold" style={heading}>{t('start.title')}</h2>
              <p className="mt-1 text-sm text-[#3d5246]">{t('start.sub')}</p>
            </div>
            <button
              type="button"
              onClick={() => updateStartPrefs({ hidden: true })}
              aria-label={t('start.hide')}
              title={t('start.hide')}
              className="shrink-0 rounded-full p-1.5 text-[#3d5246] hover:bg-[#F3F7F4]"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div
              className="h-2.5 flex-1 rounded-full bg-[#F3F7F4]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={startSteps.length}
              aria-valuenow={startDone}
              aria-label={startProgress}
            >
              <div className="h-2.5 rounded-full bg-[#1F6B45] transition-all" style={{ width: `${(startDone / startSteps.length) * 100}%` }} />
            </div>
            <p className="shrink-0 text-sm font-semibold text-[#3d5246]">{startProgress}</p>
          </div>

          <ol className="mt-3 space-y-2">
            {startSteps.map((s, i) => {
              const isNext = nextStep?.id === s.id
              const badge = (
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.done ? 'bg-[#1F6B45] text-white' : 'bg-white text-[#14251C] ring-1 ring-[#14251C]/20'}`}
                >
                  {s.done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
              )
              const optionalTag = s.optional && !s.done && (
                <span className="ml-2 whitespace-nowrap rounded-full bg-white px-2 py-0.5 align-middle text-xs font-semibold text-[#3d5246] ring-1 ring-[#14251C]/15">
                  {t('start.optional')}
                </span>
              )

              // Done or waiting: one quiet line
              if (!isNext) {
                return (
                  <li key={s.id} className="flex items-center gap-3 rounded-xl bg-[#F3F7F4] px-3 py-2.5">
                    {badge}
                    <p className={`min-w-0 flex-1 text-sm font-semibold ${s.done ? 'text-[#3d5246] line-through decoration-[#3d5246]/40' : 'text-[#3d5246]'}`}>
                      {stepTitle(s.id)}
                      {optionalTag}
                    </p>
                    {s.done && <span className="shrink-0 text-sm font-semibold text-[#1F6B45]">{t('start.done')}</span>}
                    {!s.done && s.optional && (
                      <Link to={s.to} className="shrink-0 rounded-full border border-[#14251C]/20 px-3 py-1 text-xs font-bold hover:bg-white">
                        {stepBtn(s.id)}
                      </Link>
                    )}
                  </li>
                )
              }

              // The current step: open, with its action. Buttons stack on phones so nothing wraps awkwardly.
              return (
                <li key={s.id} className="rounded-xl bg-[#F2B632]/20 p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    {badge}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {stepTitle(s.id)}
                        {optionalTag}
                      </p>
                      <p className="text-sm text-[#3d5246]">{stepText(s.id)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-start">
                    <Link
                      to={s.to}
                      className="rounded-full bg-[#14251C] px-5 py-2.5 text-center text-sm font-bold text-white hover:bg-[#1F6B45]"
                    >
                      {stepBtn(s.id)}
                    </Link>
                    {s.id === 's2' && (
                      <button
                        type="button"
                        onClick={() => updateStartPrefs({ noCustomers: true })}
                        className="rounded-full px-3 py-2 text-center text-sm font-semibold text-[#3d5246] underline hover:text-[#1F6B45]"
                      >
                        {t('start.owe.skip')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {/* New business with no products: a friendly placeholder instead of a page full of zeros */}
      {isEmpty && (
        <section className={`${card} text-center`}>
          <p className="text-xl font-extrabold" style={heading}>{t('dash.empty.title')}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#3d5246]">{t('dash.empty.text')}</p>
          {!showStart && (
            <Link to="/app/inventory" className="mt-4 inline-block rounded-full bg-[#14251C] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#1F6B45]">
              {t('start.s1.btn')}
            </Link>
          )}
        </section>
      )}

      {/* Everything below shows once the first product exists */}
      {loading && (
        <div className="space-y-6" aria-hidden>
          <div className="h-44 animate-pulse rounded-2xl bg-white" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-white" />)}
          </div>
        </div>
      )}

      {showContent && (
        <>

          {/* Needs attention + recent activity */}
          <div className="grid gap-6 lg:grid-cols-12">
            <section className={`${card} lg:col-span-5`} aria-labelledby="att-title">
              <h2 id="att-title" className="border-l-4 border-[#E4572E] pl-3 font-bold">{tx('dash.att.title', 'Needs attention')}</h2>
              {attention.length === 0 ? (
                <p className="mt-4 flex items-center gap-2 text-sm text-[#3d5246]"><Check className="h-4 w-4 text-[#1F6B45]" aria-hidden /> {tx('dash.att.ok', 'All clear. Nothing needs attention right now.')}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {attention.slice(0, 6).map((a) => (
                    <li key={a.id}>
                      <Link to={a.to} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 hover:brightness-95 ${a.level === 'warn' ? 'bg-[#E4572E]/10' : 'bg-[#F3F7F4]'}`}>
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.level === 'warn' ? 'bg-[#E4572E]' : 'bg-[#F2B632]'}`} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{a.title}</span>
                          <span className="block truncate text-xs text-[#3d5246]">{a.detail}</span>
                        </span>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-[#3d5246]" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={`${card} lg:col-span-7`} aria-labelledby="act-title">
              <h2 id="act-title" className="border-l-4 border-[#1F6B45] pl-3 font-bold">{tx('dash.act.title', 'Recent activity')}</h2>
              {activity.length === 0 ? (
                <p className="mt-4 text-sm text-[#3d5246]">{tx('dash.act.none', 'Nothing recorded yet. Use the Record button to start.')}</p>
              ) : (
                <ul className="mt-3 divide-y divide-[#14251C]/10">
                  {activity.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2.5">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${a.in ? 'bg-[#1F6B45]/15 text-[#1F6B45]' : 'bg-[#E4572E]/15 text-[#E4572E]'}`}>
                        {a.in ? <ArrowDownRight className="h-4 w-4" aria-hidden /> : <ArrowUpRight className="h-4 w-4" aria-hidden />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{a.label}{a.who ? ` · ${a.who}` : ''}</p>
                        <p className="text-xs text-[#3d5246]">{a.date}</p>
                      </div>
                      <p className={`shrink-0 text-sm font-bold ${a.in ? 'text-[#1F6B45]' : ''}`}>{a.in ? '+' : '−'}{fmt(a.amount)} RWF</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Income vs expenses by month */}
          <section className={card} aria-labelledby="ie-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="ie-title" className="border-l-4 border-[#F2B632] pl-3 font-bold">{tx('dash.ie.title', 'Income vs expenses')}</h2>
              <div className="flex items-center gap-4 text-xs text-[#3d5246]">
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#1F6B45]" /> {tx('dash.ie.income', 'Income')}</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#F2B632]" /> {tx('dash.ie.expenses', 'Expenses')}</span>
              </div>
            </div>
            {!chartHas ? (
              <p className="mt-4 text-sm text-[#3d5246]">{tx('dash.ie.none', 'No income or expenses recorded in the last 6 months.')}</p>
            ) : (
              <div className="mt-5 grid grid-cols-6 gap-2 sm:gap-4">
                {monthly6.map((m, i) => (
                  <div key={i} className="min-w-0" title={`${m.label}: ${fmt(m.income)} / ${fmt(m.expenses)} RWF`}>
                    <div className="flex h-36 items-end justify-center gap-1">
                      <div className="w-full max-w-[1.5rem] rounded-t-md bg-[#1F6B45]" style={{ height: `${Math.max(m.income > 0 ? 3 : 0, (m.income / chartMax) * 100)}%` }} />
                      <div className="w-full max-w-[1.5rem] rounded-t-md bg-[#F2B632]" style={{ height: `${Math.max(m.expenses > 0 ? 3 : 0, (m.expenses / chartMax) * 100)}%` }} />
                    </div>
                    <p className="mt-1.5 text-center text-xs font-semibold text-[#3d5246]">{m.label}</p>
                    <p className={`truncate text-center text-[10px] font-bold ${m.income - m.expenses < 0 ? 'text-[#E4572E]' : 'text-[#1F6B45]'}`}>
                      {m.income - m.expenses < 0 ? '−' : '+'}{fmt(Math.abs(m.income - m.expenses))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Row 1: revenue, total sales, inventory valuation */}
          <div className="grid gap-6 lg:grid-cols-12">
            <section className={`${card} lg:col-span-5`}>
              <h2 className="border-l-4 border-[#1F6B45] pl-3 font-bold">{t('dash.salesRevenue')}</h2>
              <div className="mt-6 space-y-4">
                <div>
                  <BigNumber value={fmt(d.revenue)} unit="RWF" size="lg" />
                  <p className="mt-2 text-sm text-[#3d5246]">{t('dash.soldIn', { month: monthName })}</p>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-2xl bg-[#14251C] p-4 text-white">
                  <div className="flex items-center gap-3">
                    <ArrowDownToLine className="h-6 w-6 shrink-0 text-[#F2B632]" aria-hidden />
                    <p className="text-sm text-white/70">{t('dash.ordersThisMonth')}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-3xl font-extrabold leading-tight" style={heading}>{fmt(d.orders)}</p>
                    {orderChange !== null && (
                      <p className="flex items-center justify-end gap-1 text-sm text-[#F2B632]">
                        {orderChange >= 0 ? <ArrowUpRight className="h-4 w-4" aria-hidden /> : <ArrowDownRight className="h-4 w-4" aria-hidden />}
                        {t('dash.vsLastMonth', { n: Math.abs(orderChange) })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className={`${card} lg:col-span-4`}>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="border-l-4 border-[#F2B632] pl-3 font-bold">{t('dash.totalSales')}</h2>
                  <p className="mt-1 pl-4 text-sm text-[#3d5246]">{range === 'Week' ? t('dash.last7') : t('dash.last12')}</p>
                </div>
                <div className="flex rounded-full bg-[#F3F7F4] p-1 text-xs font-semibold">
                  {(['Week', 'Month'] as const).map((r) => (
                    <button key={r} onClick={() => { setRange(r); setHoverBar(null) }} aria-pressed={range === r}
                      className={`rounded-full px-3 py-1 ${range === r ? 'bg-[#14251C] text-white' : ''}`}>
                      {t(r === 'Week' ? 'dash.week' : 'dash.month')}
                    </button>
                  ))}
                </div>
              </div>
              {barTotal === 0 ? (
                <p className="mt-6 flex h-32 items-center text-sm text-[#3d5246]">{t('dash.noSalesPeriod')}</p>
              ) : (
                <>
                  <div
                    className="mt-6 flex h-32 items-end gap-1.5"
                    role="group"
                    aria-label={t(range === 'Week' ? 'dash.chartAria.day' : 'dash.chartAria.month', { total: fmt(barTotal) })}
                    onMouseLeave={() => setHoverBar(null)}
                  >
                    {bars.map((b, i) => {
                      const h = Math.max(4, (b.value / barMax) * 100)
                      const last = i === bars.length - 1
                      const active = hoverBar === i
                      return (
                        // the whole column is the hover area, so days with no sales can be checked too
                        <div
                          key={i}
                          tabIndex={0}
                          aria-label={`${b.full}: ${fmt(b.value)} RWF`}
                          onMouseEnter={() => setHoverBar(i)}
                          onFocus={() => setHoverBar(i)}
                          onBlur={() => setHoverBar(null)}
                          onClick={() => setHoverBar(active ? null : i)}
                          className="relative flex h-full flex-1 cursor-pointer flex-col justify-end outline-none"
                        >
                          {active && (
                            <div
                              role="tooltip"
                              className={`pointer-events-none absolute z-10 whitespace-nowrap rounded-xl bg-[#14251C] px-3 py-1.5 text-center text-xs text-white shadow-lg ring-1 ring-white/20 ${
                                i === 0 ? 'left-0' : last ? 'right-0' : 'left-1/2 -translate-x-1/2'
                              }`}
                              style={{ bottom: `min(calc(${h}% + 6px), calc(100% - 44px))` }}
                            >
                              <p className="text-white/70">{b.full}</p>
                              <p className="font-bold">{fmt(b.value)} RWF</p>
                            </div>
                          )}
                          <div
                            className={`rounded-full transition-colors ${
                              last ? (active ? 'bg-[#175235]' : 'bg-[#1F6B45]') : active ? 'bg-[#9CC4AE]' : 'bg-[#DDE5DF]'
                            }`}
                            style={{ height: `${h}%` }}
                          />
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-1.5 flex gap-1.5 text-[10px] text-[#3d5246]" aria-hidden>
                    {bars.map((b, i) => <span key={i} className="flex-1 text-center">{b.label}</span>)}
                  </div>
                </>
              )}
            </section>

            <section className="rounded-2xl bg-gradient-to-br from-[#1F6B45] to-[#14251C] p-6 text-white shadow-sm lg:col-span-3">
              <BigNumber value={fmt(d.valuation)} unit="RWF" />
              <p className="text-sm text-white/70">{t('dash.inventoryValuation')}</p>
              <p className="mt-4 text-sm text-white/70">
                {t(state.products.length === 1 ? 'dash.productsAtCost.one' : 'dash.productsAtCost.many', { n: state.products.length })}
              </p>
            </section>
          </div>

          {/* Row 2: profit and collections this month */}
          <div className="flex items-center justify-between pt-2">
            <h2 className="text-xl font-extrabold" style={heading}>{t('dash.moneyIn', { month: monthName })}</h2>
            <Link to="/app/reports" className="text-sm font-semibold text-[#1F6B45] hover:underline">{t('dash.fullReports')}</Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <section className="rounded-2xl bg-[#14251C] p-5 text-white">
              <BigNumber value={fmt(pl.grossProfit)} unit="RWF" className={pl.grossProfit < 0 ? 'text-[#F2B632]' : ''} />
              <p className="text-sm text-white/70">{t('dash.grossProfitRwf')}</p>
              <p className="mt-1 text-xs text-white/60">
                {pl.grossMargin !== null ? t('dash.ofSold', { pct: pct(pl.grossMargin) }) : t('dash.noSalesMonth')}
              </p>
            </section>
            <section className="rounded-2xl bg-[#F2B632] p-5 text-[#14251C]">
              <BigNumber value={fmt(pl.totalExpenses)} unit="RWF" />
              <p className="text-sm font-semibold">{t('dash.expensesRwf')}</p>
              <p className="mt-1 text-xs">{t('dash.expensesNote')}</p>
            </section>
            <section className={`rounded-2xl p-5 text-white ${pl.netProfit < 0 ? 'bg-[#E4572E]' : 'bg-[#1F6B45]'}`}>
              <BigNumber value={fmt(pl.netProfit)} unit="RWF" />
              <p className="text-sm font-semibold">{t(pl.netProfit < 0 ? 'dash.netLossRwf' : 'dash.netProfitRwf')}</p>
              <p className="mt-1 text-xs text-white/80">
                {pl.netMargin !== null ? t('dash.ofSold', { pct: pct(pl.netMargin) }) : t('dash.grossMinusExpenses')}
              </p>
            </section>
            <section className={card}>
              <BigNumber value={fmt(cash.collected)} unit="RWF" />
              <p className="text-sm text-[#3d5246]">{t('dash.collectedOf', { sold: `${fmt(pl.revenue)} RWF` })}</p>
              <div className="mt-3 h-2 rounded-full bg-[#F3F7F4]" role="img" aria-label={t('dash.collectedAria', { n: Math.round(collectedShare) })}>
                <div className="h-2 rounded-full bg-[#1F6B45]" style={{ width: `${collectedShare}%` }} />
              </div>
            </section>
          </div>

          {/* Row 3: stock tiles + who owes what */}
          <div className="grid gap-6 lg:grid-cols-12">
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:col-span-7">
              {tiles.map((tile) => (
                <Link key={tile.id} to="/app/inventory" title={tile.hint}
                  className={`flex min-h-[8rem] flex-col justify-between rounded-2xl p-5 ${tile.cls} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14251C]`}>
                  <p className="text-4xl font-extrabold" style={heading}>{tile.n}</p>
                  <p className="text-sm font-semibold">{tile.label}</p>
                </Link>
              ))}
            </section>

            <section className={`${card} lg:col-span-5`}>
              <h2 className="border-l-4 border-[#E4572E] pl-3 font-bold">{t('dash.whoOwes')}</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Link to="/app/customers" className="rounded-xl bg-[#F3F7F4] p-3 hover:bg-[#E8EFEA]">
                  <p className="text-xs text-[#3d5246]">{t('pay.owedToYou')}</p>
                  <p className="text-xl font-extrabold" style={heading}>{fmt(balances.receivables)} <span className="text-[0.6em]">RWF</span></p>
                  <p className={`text-xs ${d.overdue > 0 ? 'font-semibold text-[#E4572E]' : 'text-[#3d5246]'}`}>
                    {d.overdue > 0 ? t('dash.olderThan30', { amount: `${fmt(d.overdue)} RWF` }) : t('dash.nothingOverdue')}
                  </p>
                </Link>
                <Link to="/app/suppliers" className="rounded-xl bg-[#F3F7F4] p-3 hover:bg-[#E8EFEA]">
                  <p className="text-xs text-[#3d5246]">{t('dash.youOweSuppliers')}</p>
                  <p className="text-xl font-extrabold" style={heading}>{fmt(balances.payables)} <span className="text-[0.6em]">RWF</span></p>
                  <p className="text-xs text-[#3d5246]">{balances.payables > 0 ? t('dash.payFromPurchases') : t('dash.allPaidUp')}</p>
                </Link>
              </div>
              {balances.topDebtors.length > 0 && (
                <ul className="mt-3 divide-y divide-[#14251C]/10">
                  {balances.topDebtors.slice(0, 3).map((x) => (
                    <li key={x.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div>
                        <p className="font-semibold">{x.name}</p>
                        <p className="text-xs text-[#3d5246]">{t(x.oldest === 1 ? 'dash.oldest.one' : 'dash.oldest.many', { n: x.oldest })}</p>
                      </div>
                      <p className={`font-bold ${x.oldest > 60 ? 'text-[#E4572E]' : ''}`}>{fmt(x.owes)} RWF</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Row 4: reorder list + top selling products */}
          <div className="grid gap-6 lg:grid-cols-12">
            <section className={`${card} lg:col-span-5`}>
              <div className="flex items-center justify-between">
                <h2 className="border-l-4 border-[#E4572E] pl-3 font-bold">{t('dash.needsReorder')}</h2>
                {reorderShown.length > 5 && (
                  <Link to="/app/inventory" className="text-sm font-semibold text-[#1F6B45] hover:underline">{t('dash.seeAll', { n: reorderShown.length })}</Link>
                )}
              </div>
              {reorderShown.length === 0 ? (
                <p className="mt-4 text-sm text-[#3d5246]">
                  {state.products.length === 0 ? t('dash.noProducts') : t('dash.stockHealthy')}
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-[#14251C]/10">
                  {reorderShown.slice(0, 5).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                      <p className="font-semibold">{p.name}</p>
                      <div className="text-right text-sm">
                        <p className="font-bold text-[#E4572E]">
                          {p.stock <= 0 ? t('stock.outOfStock') : t('dash.left', { n: fmt(p.stock), unit: unitLabel(p.unit).toLowerCase() })}
                        </p>
                        <p className="text-[#3d5246]">{t('dash.reorderAt', { n: fmt(p.reorder) })}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={`${card} lg:col-span-7`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="border-l-4 border-[#F2B632] pl-3 font-bold">{t('dash.topSelling')}</h2>
                  <p className="mt-1 pl-4 text-sm text-[#3d5246]">{t('dash.last30')}</p>
                </div>
                <div className="flex rounded-full bg-[#F3F7F4] p-1 text-sm font-semibold">
                  {(['units', 'revenue'] as const).map((k) => (
                    <button key={k} onClick={() => setMetric(k)} aria-pressed={metric === k}
                      className={`rounded-full px-4 py-1.5 ${metric === k ? 'bg-[#14251C] text-white' : ''}`}>
                      {t(k === 'units' ? 'dash.byUnits' : 'dash.byRevenue')}
                    </button>
                  ))}
                </div>
              </div>
              {ranked.length === 0 ? (
                <p className="mt-6 text-sm text-[#3d5246]">{t('dash.noSales30')}</p>
              ) : (
                <ul className="mt-6 space-y-4">
                  {ranked.map((p, i) => (
                    <li key={p.name}>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-[#3d5246]">{metric === 'units' ? t('dash.sold', { n: fmt(p.units) }) : `${fmt(p.revenue)} RWF`}</span>
                      </div>
                      <div className="mt-1.5 h-3 rounded-full bg-[#F3F7F4]">
                        <div className={`h-3 rounded-full ${i === 0 ? 'bg-[#1F6B45]' : 'bg-[#9CC4AE]'}`} style={{ width: `${(p[metric] / rankMax) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
