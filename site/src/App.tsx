import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { MotionConfig, motion } from 'framer-motion'
import { ArrowDown, ChevronDown, ChevronLeft, ChevronRight, Menu, RotateCcw, Search, Share2, X } from 'lucide-react'
import { getChoseong } from 'es-hangul'
import { Toaster, toast } from 'sonner'
import { aliases, campaign, candidates, categories, roadmap, type Block, type Candidate, type Category, type Pledge, type Step } from './data/site'

const { vote } = campaign
const listed = (c: Category) => c.pledges.filter((p) => !p.hidden)
const all = categories.flatMap(listed)
const mains = all.filter((p) => p.core)
const pledgeIndex = new Map(categories.flatMap((c) => c.pledges.map((p, i) => [p.id, { p, c, i }] as const)))
const catById = new Map(categories.map((c) => [c.id, c]))

/* 로드맵 문구: "[계절학기 수요조사](summer-session)" → 해당 공약으로 이어지는 링크 */
const LINK = /\[([^\]]+)\]\(([\w-]+)\)/g
const roadmapByPledge = new Map<string, { period: string; text: string }[]>()
for (const rows of Object.values(roadmap.rows))
  rows.forEach((cell, pi) =>
    cell.forEach((line) => {
      for (const m of line.matchAll(LINK)) {
        const list = roadmapByPledge.get(m[2]) ?? []
        if (!list.some((e) => e.period === roadmap.periods[pi] && e.text === m[1])) list.push({ period: roadmap.periods[pi], text: m[1] })
        roadmapByPledge.set(m[2], list)
      }
    }),
  )

/* 공약 찾기: 낱말(띄어쓰기 무시) 또는 초성(ㄷㄹㄱ)으로 공약명·약속 문장을 찾는다. 초성 분해는 toss/es-hangul */
const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const searchIndex = categories.flatMap((c) => listed(c).map((p) => ({ p, c, text: squash(p.title + (p.promise ?? '')), cho: squash(getChoseong(p.title)) })))
const findPledges = (q: string) => {
  const n = squash(q)
  if (!n) return null
  const byCho = /^[ㄱ-ㅎ]+$/.test(n)
  return searchIndex.filter((e) => (byCho ? e.cho.includes(n) : e.text.includes(n)))
}

/* 투표일까지 남은 날 (한국 시간 기준 날짜 차이). 투표 기간이 지나면 표시하지 않는다 */
const dday = (() => {
  if (!vote.start || !vote.end) return null
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  const left = Math.round((Date.parse(vote.start) - Date.parse(today)) / 864e5)
  if (left > 0) return { mark: `D-${left}`, text: '투표 시작까지' }
  if (today <= vote.end) return { mark: left === 0 ? 'D-DAY' : '투표 중', text: '지금 투표 기간입니다' }
  return null
})()
const shortPeriod = vote.period.replace(/^\d{4}\.\s*/, '')

/* 공약 상세는 #/p/<id> 해시 화면. 목록·일정은 그대로 둔 채 위에 덮어서, 돌아오면 보던 자리와 선택한 시기가 그대로 남는다. */
const detailHash = (id: string) => `#/p/${id}`
const readDetail = () => {
  const m = location.hash.match(/^#\/p\/([\w-]+)$/)
  if (!m) return null
  const id = aliases[m[1]] ?? m[1] // 통합된 공약의 예전 주소 → 합쳐진 공약으로
  if (id !== m[1]) history.replaceState(history.state, '', detailHash(id))
  return pledgeIndex.has(id) ? id : null
}
const nav: { fromList: boolean; scrollY: number; from: string; opener: HTMLElement | null } = { fromList: false, scrollY: 0, from: 'list', opener: null }
if ('scrollRestoration' in history) history.scrollRestoration = 'manual' // 돌아올 때 위치는 직접 복원
const afterPaint = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn))
const flash = (el: Element) => {
  el.classList.add('just-read')
  setTimeout(() => el.classList.remove('just-read'), 2200)
}

/* 공유: 휴대폰은 공유 시트, 안 되는 환경은 주소 복사 */
async function share(title: string, hash = '') {
  const url = location.origin + location.pathname + hash
  if (navigator.share) {
    try {
      await navigator.share({ title, url })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    toast('주소를 복사했습니다')
  } catch {
    toast('주소를 복사하지 못했습니다. 주소창에서 직접 복사해 주세요')
  }
}

function openFromList(e: MouseEvent<HTMLAnchorElement>) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  nav.fromList = true
  nav.scrollY = window.scrollY
  nav.opener = e.currentTarget
  nav.from = e.currentTarget.dataset.from ?? 'list'
}

/* 분야 목차·기조문 → 월별 추진 일정의 해당 분야로 */
const showRoadmapField = (field: string) => window.dispatchEvent(new CustomEvent('roadmap-field', { detail: field }))

const navLinks = [
  ['#pledges', '공약'],
  ['#roadmap', '월별 추진 일정'],
  ['#candidates', '후보 소개'],
  ['#statement', '기조문'],
  ['#vote', '투표 안내'],
]

/* 지금 보고 있는 구역을 메뉴에 표시 */
function useActiveSection() {
  const [active, setActive] = useState('')
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(`#${e.target.id}`)), { rootMargin: '-35% 0px -60% 0px' })
    for (const [href] of navLinks) {
      const el = document.querySelector(href)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [])
  return active
}

/* GOV.UK Frontend service navigation 방식: 모바일에선 aria-expanded 버튼으로 목록을 열고 닫고, 넓은 화면에선 항상 펼침 */
function Header() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const active = useActiveSection()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <header className="gutter sticky top-0 z-30 border-b border-white/10 bg-navy">
      <div className="wrap flex h-14 items-center justify-between gap-4">
        <a href="#top" className="flex items-center gap-2.5" aria-label={`${campaign.nameEn} 처음으로`}>
          <img src="figma/logo-orange.svg" alt="" className="logo h-7 w-auto" />
          <span className="t-wordmark">{campaign.nameEn}</span>
        </a>
        <button
          ref={button}
          type="button"
          aria-controls="site-menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="menu-btn -mr-2 flex items-center gap-1.5 rounded-lg px-2 py-2 text-[15px] font-semibold lg:hidden"
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          메뉴
        </button>
        <nav aria-label="주 메뉴" className="max-lg:absolute max-lg:inset-x-0 max-lg:top-14">
          <ul id="site-menu" className={`${open ? 'block' : 'hidden'} border-b border-white/10 bg-navy px-4 pb-2 lg:flex lg:gap-8 lg:border-0 lg:bg-transparent lg:p-0`}>
            {navLinks.map(([href, t]) => (
              <li key={href} className="border-t border-white/10 first:border-t-0 lg:border-0">
                <a href={href} aria-current={active === href ? 'location' : undefined} onClick={() => setOpen(false)} className="nav-link block py-3.5 text-[17px] font-semibold lg:py-[17px] lg:text-[15px]">
                  {t}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}

/* 1면 표지: 짙은 남색 + 하단으로 번지는 주황빛, 흰색 심벌, '동력 정책자료집', 캠퍼스 선화.
   들어올 때 한 번, 손글씨 슬로건이 써지듯 나타난다 */
function Hero() {
  return (
    <section id="top" aria-labelledby="cover-title" className="cover-bg relative overflow-hidden">
      <div className="gutter relative z-10">
        <div className="hero wrap">
          <p className="t-cover-org in in-1">{campaign.org}</p>
          <img src="figma/logo-white.svg" alt="" fetchPriority="high" className="hero-logo logo in in-1" />
          <h1 id="cover-title" className="t-cover-title in in-2">
            {campaign.bookTitle}
          </h1>
          <p className="hero-hand">
            <img src="figma/slogan-final.png" alt={campaign.slogan} width={994} height={212} fetchPriority="high" className="write h-auto w-full" />
          </p>
          <p className="hero-sub t-lead in in-4 text-white/85">{campaign.sloganSub}</p>
          <div className="hero-cta in in-4">
            <a href="#pledges" className="cta btn btn-fill">
              공약 보기
            </a>
            <a href="#roadmap" className="cta btn btn-line">
              월별 추진 일정
            </a>
          </div>
          <a href="#vote" className="cta vote-strip in in-4">
            <span>
              <span className="mr-2.5 text-white/60">투표</span>
              <span className="font-semibold tabular-nums">{shortPeriod}</span>
            </span>
            {dday && <strong className="text-orange tabular-nums">{dday.mark}</strong>}
          </a>
        </div>
      </div>
      <img
        src="figma/campus-lineart-cover.webp"
        srcSet="figma/campus-lineart-cover-900.webp 900w, figma/campus-lineart-cover.webp 1748w"
        sizes="(min-width: 1280px) 1280px, 100vw"
        alt=""
        width={1748}
        height={1262}
        className="hero-art"
      />
    </section>
  )
}

/* 2~3면 후보 소개: '동국을 움직일 힘, 동력을 만들다' → 두 후보 사진(왼쪽 부후보 전채희, 오른쪽 정후보 전호빈) → 이름·전공 → 연도별 약력 */
function Bio({ c, className = '' }: { c: Candidate; className?: string }) {
  return (
    <section aria-labelledby={`bio-${c.name}`} className={className}>
      <h3 id={`bio-${c.name}`} className="t-pledge border-b border-ink pb-2">
        {c.role} {c.name} 약력
      </h3>
      <p className="t-meta mt-3 text-muted">{c.origin}</p>
      <dl className="mt-4 space-y-5">
        {c.history.map((h) => (
          <div key={h.year} className="grid grid-cols-[3rem_1fr] gap-x-3">
            <dt className="t-year">{h.year}</dt>
            <dd>
              <ul className="space-y-1.5">
                {h.items.map((it) => (
                  <li key={it} className="t-small text-body">
                    {it}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Candidates() {
  const [lead, vice] = candidates
  return (
    <section id="candidates" aria-labelledby="candidates-title" className="gutter scroll-mt-14 bg-white py-14 text-ink sm:py-20 lg:py-24">
      <div className="wrap">
        <h2 id="candidates-title">
          <span className="sr-only">후보 소개. 동국을 움직일 힘, 동력을 만들다</span>
          <span aria-hidden className="flex flex-wrap items-end justify-center gap-x-4 gap-y-1">
            <img src="figma/hand-candidates-1.png" alt="" width={515} height={106} className="h-auto w-[min(80vw,400px)]" />
            <img src="figma/hand-candidates-2.png" alt="" width={531} height={147} className="h-auto w-[min(82vw,412px)]" />
          </span>
        </h2>
        <div className="mt-8 lg:mt-14 lg:grid lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start lg:gap-14">
          <figure className="mx-auto max-w-[600px] lg:sticky lg:top-24 lg:mx-0">
            <img
              src="photos/duo-candidates.webp"
              alt={`${vice.role} ${vice.name}(왼쪽)과 ${lead.role} ${lead.name}(오른쪽)`}
              width={1400}
              height={1392}
              loading="lazy"
              className="surface h-auto w-full bg-paper"
            />
            <figcaption className="mt-5 grid grid-cols-2 gap-3 text-center">
              {[vice, lead].map((c) => (
                <div key={c.name}>
                  <p className="t-label text-orange-ink">{c.role}</p>
                  <p className="t-name mt-0.5">{c.name}</p>
                  <p className="t-pledge mt-1.5">
                    {c.dept} {c.year}
                  </p>
                  <p className="t-meta mt-0.5 text-muted">{c.minor}</p>
                </div>
              ))}
            </figcaption>
          </figure>
          <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-10 lg:mt-0">
            <Bio c={lead} className="md:order-2" />
            <Bio c={vice} className="md:order-1" />
          </div>
        </div>
      </div>
    </section>
  )
}

/* 4면 슬로건: 먼저 움직이겠습니다 / 함께 만들겠습니다 / 끝까지 책임지겠습니다 (손글씨는 자료집 원본 벡터) */
const handOf: Record<string, [string, number, number]> = { 먼저: ['hand-first', 64, 30], 함께: ['hand-together', 71, 37], 끝까지: ['hand-end', 95, 39] }
function Slogan() {
  return (
    <section id="slogan" aria-labelledby="slogan-title" className="gutter scroll-mt-14 border-t border-line bg-white py-14 text-ink sm:py-20 lg:py-24">
      <div className="wrap lg:grid lg:grid-cols-[minmax(0,440px)_1fr] lg:gap-16">
        <div>
          <h2 id="slogan-title" className="t-h2">
            {campaign.slogan}
          </h2>
          <p className="t-lead mt-4 font-semibold">{campaign.sloganSub}</p>
          <p className="t-body mt-4 max-w-[62ch] text-body">{campaign.nameNote}</p>
        </div>
        <ul className="mt-10 lg:mt-1">
          {campaign.values.map((v) => {
            const [file, w, h] = handOf[v.key]
            return (
              <li key={v.key} className="grid grid-cols-[5.5rem_1fr] items-start gap-x-4 border-t border-ink py-5 last:border-b sm:grid-cols-[7.5rem_1fr]">
                <img src={`figma/${file}.svg`} alt={v.key} width={w} height={h} className="h-9 w-auto sm:h-11" />
                <div>
                  <p className="t-pledge-main">{v.title}</p>
                  <p className="t-body mt-1.5 text-body">{v.body}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

/* 5면 기조문 전문 + 후보 등록 서류의 출마소견(원문 구분) */
function Statement() {
  const { title, intro, powers, outro } = campaign.statement
  const sp = campaign.speech
  return (
    <section id="statement" aria-labelledby="statement-title" className="gutter scroll-mt-14 py-16 sm:py-24 lg:py-28">
      <div className="wrap grid gap-8 lg:grid-cols-[minmax(0,440px)_1fr] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="t-label text-white/60">기조문</p>
          <h2 id="statement-title" className="t-h2 mt-2">
            {title}
          </h2>
        </div>
        <div className="max-w-[62ch]">
          <div className="space-y-5">
            {intro.map((t, i) => (
              <p key={i} className="t-body text-white/85">
                {t}
              </p>
            ))}
          </div>
          <ol className="mt-8 border-b border-white/20">
            {powers.map((pw, i) => (
              <li key={pw.title} className="grid grid-cols-[3.25rem_1fr] border-t border-white/20 py-5">
                <span aria-hidden className="t-num-sm text-orange">
                  {categories[i]?.num}
                </span>
                <div>
                  <a href={`#${pw.cat}`} className="t-pledge-main text-white underline decoration-white/30 underline-offset-4 hover:decoration-orange">
                    {pw.title}
                  </a>
                  {pw.lines.map((l) => (
                    <p key={l} className="t-body mt-1 text-white/85">
                      {l}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8 space-y-5">
            {outro.map((t, i) => (
              <p key={i} className={`t-body ${i === outro.length - 1 ? 'font-semibold text-white' : 'text-white/85'}`}>
                {t}
              </p>
            ))}
          </div>

          <details className="speech mt-12 border-y border-white/25">
            <summary className="flex items-center justify-between gap-3 py-4">
              <span>
                <span className="t-pledge-main block">출마소견</span>
                <span className="t-small mt-0.5 block text-white/70">
                  선거 구호 <strong className="font-semibold text-white">{campaign.officialSlogan}</strong>
                </span>
              </span>
              <ChevronDown className="chev size-5 shrink-0 transition-transform" aria-hidden />
            </summary>
            <div className="space-y-4 pb-6">
              {sp.paragraphs.map((t, i) => (
                <p key={i} className="t-body text-white/85">
                  {t}
                </p>
              ))}
              <p className="t-small text-white/70">{sp.sign}</p>
            </div>
          </details>
        </div>
      </div>
    </section>
  )
}

/* 6면 목차 + 각 분야 표지(01·02·03). 메인공약은 도식·계획이 있는 상세로 가는 링크, 추가 공약은 자료집처럼 공약명과 설명을 그 자리에 */
function MainRow({ p, n, tag }: { p: Pledge; n?: number; tag?: string }) {
  return (
    <a href={detailHash(p.id)} data-pledge={p.id} onClick={openFromList} className="row -mx-2 flex items-center gap-3 px-2 py-4 text-ink">
      {n && (
        <span aria-hidden className="t-num-sm w-5 shrink-0">
          {n}
        </span>
      )}
      <span className="t-pledge-main min-w-0 flex-1">
        <span className="sr-only">메인공약 </span>
        {p.title}
      </span>
      {tag && <span className="t-meta shrink-0 text-muted">{tag}</span>}
      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
    </a>
  )
}

function ExtraItem({ p, tag }: { p: Pledge; tag?: string }) {
  return (
    <div data-pledge={p.id} tabIndex={-1} className="-mx-2 px-2 py-4 outline-none">
      <p className="flex items-baseline justify-between gap-3">
        <span className="t-pledge text-ink">{p.title}</span>
        {tag && <span className="t-meta shrink-0 text-muted">{tag}</span>}
      </p>
      <p className="t-body mt-1 text-body">{p.promise}</p>
    </div>
  )
}

function SectionCover({ c }: { c: Category }) {
  const n = listed(c).length
  const main = listed(c).filter((p) => p.core).length
  return (
    <div className="sec-cover surface relative overflow-hidden px-6 pt-6 text-white lg:sticky lg:top-20">
      <p aria-hidden className="t-num">
        {c.num}
      </p>
      <h3 id={`${c.id}-title`} className="t-sec-name mt-1">
        <span className="sr-only">{c.num} </span>
        {c.name}
      </h3>
      <p className="t-meta mt-2 text-white/75">
        메인공약 {main}개, 추가 공약 {n - main}개
      </p>
      <a href="#roadmap" onClick={() => showRoadmapField(c.id)} className="cta btn btn-line btn-sm relative z-10 mt-5">
        {c.short} 월별 추진 일정
      </a>
      <img src="figma/campus-lineart.webp" alt="" width={1080} height={618} loading="lazy" className="pointer-events-none relative -mx-6 -mt-6 h-auto w-[calc(100%+3rem)] max-w-none opacity-60" />
    </div>
  )
}

function CategoryToc({ c }: { c: Category }) {
  const mains = listed(c).filter((p) => p.core)
  const extras = listed(c).filter((p) => !p.core)
  return (
    <section id={c.id} aria-labelledby={`${c.id}-title`} className="scroll-mt-16 lg:grid lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start lg:gap-14">
      <SectionCover c={c} />
      <div className="mt-6 lg:mt-0">
        <h4 className="t-label text-muted">메인공약</h4>
        <ol className="mt-1 border-t border-ink">
          {mains.map((p, i) => (
            <li key={p.id} className="border-b border-line">
              <MainRow p={p} n={i + 1} />
            </li>
          ))}
        </ol>
        <h4 className="t-label mt-8 text-muted">그 외의 추가 공약</h4>
        <ul className="extras mt-1 border-t border-ink">
          {extras.map((p) => (
            <li key={p.id} className="border-b border-line">
              <ExtraItem p={p} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Pledges() {
  const [q, setQ] = useState('')
  const found = useMemo(() => findPledges(q), [q])
  const input = useRef<HTMLInputElement>(null)
  return (
    <section id="pledges" aria-labelledby="pledges-title" className="gutter scroll-mt-14 bg-white pt-14 pb-16 text-ink sm:pt-20 sm:pb-24 lg:pt-24">
      <div className="wrap">
        <div className="lg:grid lg:grid-cols-[minmax(0,380px)_1fr] lg:items-end lg:gap-14">
          <div>
            <h2 id="pledges-title" className="t-h2">
              {campaign.tocTitle}
            </h2>
            <p className="t-body mt-3 text-body">
              메인공약 {all.filter((p) => p.core).length}개와 추가 공약 {all.filter((p) => !p.core).length}개를 담았습니다. 메인공약을 누르면 추진 방법과 계획을 볼 수 있습니다.
            </p>
          </div>
          <div className="mt-6 lg:mt-0">
            <nav aria-label="분야 바로가기" className="grid grid-cols-3 border-y border-ink">
              {categories.map((c) => (
                <a key={c.id} href={`#${c.id}`} className="row jump px-1 py-3 sm:px-3">
                  <span aria-hidden className="t-num-sm block">
                    {c.num}
                  </span>
                  <span className="t-pledge mt-0.5 block">
                    {c.short} <span className="font-normal text-muted">{listed(c).length}개</span>
                  </span>
                </a>
              ))}
            </nav>
            <div role="search" className="search mt-4">
              <Search className="size-5 shrink-0 text-muted" aria-hidden />
              <input
                ref={input}
                type="text"
                inputMode="search"
                enterKeyHint="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="공약 찾기"
                placeholder="공약 찾기 (예: 등록금, ㅇㅇㅍㅇ)"
                autoComplete="off"
              />
              {q && (
                <button
                  type="button"
                  aria-label="검색어 지우기"
                  onClick={() => {
                    setQ('')
                    input.current?.focus()
                  }}
                  className="back -mr-1 rounded-full p-1.5"
                >
                  <X className="size-5" aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>

        <div aria-live="polite">
          {found && (
            <div className="mt-8">
              <p className="t-label text-muted">{found.length > 0 ? `찾은 공약 ${found.length}개` : `‘${q.trim()}’이(가) 들어간 공약이 없습니다. 다른 낱말로 찾아보세요.`}</p>
              {found.length > 0 && (
                <ul className="mt-1 border-t border-ink">
                  {found.map(({ p, c }) => (
                    <li key={p.id} className="border-b border-line">
                      {p.core ? <MainRow p={p} tag={c.short} /> : <ExtraItem p={p} tag={c.short} />}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div hidden={!!found} className="mt-12 space-y-16 sm:space-y-20 lg:mt-16">
          {categories.map((c) => (
            <CategoryToc key={c.id} c={c} />
          ))}
        </div>
      </div>
    </section>
  )
}

/* 11·16·21면 실행 로드맵 → 하나의 월별 일정. 모바일: 시기를 고르면 세 분야가 세로로 / 데스크톱: 시기 = 열, 분야 = 행 */
function RoadmapLine({ line }: { line: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of line.matchAll(LINK)) {
    if (m.index! > last) parts.push(line.slice(last, m.index))
    parts.push(
      <a key={m.index} href={detailHash(m[2])} data-pledge={m[2]} data-from="roadmap" onClick={openFromList} className="rm-link">
        {m[1]}
      </a>,
    )
    last = m.index! + m[0].length
  }
  if (last < line.length) parts.push(line.slice(last))
  return <>{parts}</>
}

/* 시기 버튼: 고른 시기의 주황 바탕이 버튼 사이를 미끄러져 옮겨 간다 */
function PeriodButton({ on, onClick, scope, children, className = '' }: { on: boolean; onClick: () => void; scope: string; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`period-btn ${className}`}>
      {on && <motion.span layoutId={`period-${scope}`} className="period-on" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
      <span className="relative">{children}</span>
    </button>
  )
}

function Roadmap() {
  const [period, setPeriod] = useState(0)
  const [focusField, setFocusField] = useState<string | null>(null)
  const fields = Object.keys(roadmap.rows)
  useEffect(() => {
    const on = (e: Event) => {
      const field = (e as CustomEvent<string>).detail
      setFocusField(field)
      afterPaint(() => {
        const el = [...document.querySelectorAll<HTMLElement>(`[data-rm-field="${field}"]`)].find((x) => x.offsetParent)
        el?.scrollIntoView({ block: 'start', behavior: 'instant' })
        window.scrollBy({ top: -72, behavior: 'instant' })
        if (el) flash(el)
      })
      setTimeout(() => setFocusField(null), 2600)
    }
    window.addEventListener('roadmap-field', on)
    return () => window.removeEventListener('roadmap-field', on)
  }, [])
  return (
    <section id="roadmap" aria-labelledby="roadmap-title" className="gutter scroll-mt-14 bg-paper py-14 text-ink sm:py-20 lg:py-24">
      <div className="wrap">
        <h2 id="roadmap-title" className="t-h2">
          월별 추진 일정
        </h2>
        <p id="roadmap-desc" className="t-body mt-3 text-body">
          <span className="block">세 분야의 일정을 시기별로 모았습니다.</span>
          <span className="block">굵은 글씨를 누르면 공약으로 이동합니다.</span>
        </p>

        {/* 모바일·태블릿: 시기 선택 → 세 분야 */}
        <div className="lg:hidden">
          <div role="group" aria-label="시기 선택" className="mt-7 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {roadmap.periods.map((t, i) => (
              <PeriodButton key={t} on={period === i} onClick={() => setPeriod(i)} scope="m" className="px-2 py-3">
                {t}
              </PeriodButton>
            ))}
          </div>
          <div aria-live="polite" className="mt-7 border-b border-ink">
            <p className="sr-only">{roadmap.periods[period]} 추진 일정</p>
            {fields.map((f) => {
              const c = catById.get(f)!
              return (
                <section key={f} data-rm-field={f} aria-label={`${c.name} ${roadmap.periods[period]}`} className={`rm-card grid grid-cols-[3.25rem_1fr] border-t border-ink py-5 ${focusField === f ? 'is-focus' : ''}`}>
                  <span aria-hidden className="t-num-sm">
                    {c.num}
                  </span>
                  <div>
                    <p className="t-pledge-main">{c.name}</p>
                    <ul className="mt-2.5 space-y-2">
                      {roadmap.rows[f][period].map((line) => (
                        <li key={line} className="t-pledge font-normal text-body">
                          <RoadmapLine line={line} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )
            })}
          </div>
        </div>

        {/* 데스크톱: 시기 = 열, 분야 = 행 */}
        <div className="mt-10 hidden lg:block">
          <table className="rm-table w-full table-fixed border-separate border-spacing-0">
            <caption className="sr-only">분야별 월별 추진 일정</caption>
            <thead>
              <tr>
                <th scope="col" className="w-[168px]">
                  <span className="sr-only">분야</span>
                </th>
                {roadmap.periods.map((t, i) => (
                  <th key={t} scope="col" className="px-1 pb-3">
                    <PeriodButton on={period === i} onClick={() => setPeriod(i)} scope="d" className="w-full px-2 py-2.5">
                      {t}
                    </PeriodButton>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => {
                const c = catById.get(f)!
                return (
                  <tr key={f} data-rm-field={f} className={focusField === f ? 'is-focus' : ''}>
                    <th scope="row" className="rm-rowhead py-5 pr-3 pl-4 text-left align-top">
                      <span className="t-num-sm block">{c.num}</span>
                      <span className="t-pledge mt-1 block">{c.name}</span>
                    </th>
                    {roadmap.rows[f].map((cell, i) => (
                      <td key={i} className={`rm-cell px-3 py-5 align-top ${period === i ? 'is-on' : ''}`}>
                        <ul className="space-y-2">
                          {cell.map((line) => (
                            <li key={line} className="t-small text-body">
                              <RoadmapLine line={line} />
                            </li>
                          ))}
                        </ul>
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

/* 상세 도식: 단계 흐름(세로 번호 + 연결선, 반복이면 마지막에 되돌아가는 표시) */
function Flow({ steps, loop }: { steps: Step[]; loop?: string }) {
  const short = steps.every((s) => !s.body && !s.chips)
  return (
    <div className="mt-5">
      <ol className={short ? 'cycle' : 'flow'}>
        {steps.map((s, k) => (
          <li key={k} className="flow-step">
            <span className="flow-num" aria-hidden>
              {k + 1}
            </span>
            <div className="min-w-0">
              <p className="t-pledge text-ink">
                <span className="sr-only">{k + 1}단계 </span>
                {s.title}
                {s.tag && <span className="flow-tag ml-2 align-[2px]">{s.tag}</span>}
              </p>
              {s.body && <p className="t-body mt-1 text-body">{s.body}</p>}
              {s.chips && (
                <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                  {s.chips.map((ch) => (
                    <li key={ch.t} className="surface bg-navy px-4 py-3 text-white">
                      <p className="font-bold">{ch.t}</p>
                      <p className="t-small mt-0.5 text-white/85">{ch.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {short && k < steps.length - 1 && <ArrowDown className="cycle-arrow size-5 text-orange-ink" aria-hidden />}
          </li>
        ))}
      </ol>
      {loop && (
        <p className="t-pledge mt-3 inline-flex items-center gap-2 rounded-full bg-orange/15 px-4 py-2 text-orange-ink">
          <RotateCcw className="size-4" aria-hidden />
          {loop}
        </p>
      )}
    </div>
  )
}

function Branches({ branches }: { branches: Extract<Block, { type: 'branches' }>['branches'] }) {
  return (
    <div className="mt-2 grid gap-8 md:grid-cols-2">
      {branches.map((b, i) => (
        <section key={b.id} id={`branch-${b.id}`} aria-labelledby={`branch-${b.id}-t`} className={`scroll-mt-20 ${i > 0 ? 'max-md:border-t max-md:border-line max-md:pt-8' : ''}`}>
          <h3 id={`branch-${b.id}-t`} className="t-h3">
            {b.label}
          </h3>
          <ol className="mt-4 space-y-4">
            {b.steps.map((s, k) => (
              <li key={k} className="grid grid-cols-[auto_1fr] gap-3">
                {s.tag ? <span className="flow-tag mt-0.5 self-start whitespace-nowrap">{s.tag}</span> : <span aria-hidden className="mark mt-[0.7em]" />}
                <div>
                  {s.title && <p className="font-bold text-ink">{s.title}</p>}
                  <p className="t-body text-body">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function PledgeDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const entry = pledgeIndex.get(id)!
  const focus = entry.p.focus
  const { p, c } = entry.p.ref ? pledgeIndex.get(entry.p.ref)! : entry
  const at = p.core ? mains.findIndex((x) => x.id === p.id) : -1
  const prev = at > 0 ? mains[at - 1] : undefined
  const next = at >= 0 ? mains[at + 1] : undefined
  const [from] = useState(() => (nav.fromList ? nav.from : 'list'))
  const heading = useRef<HTMLHeadingElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    if (focus)
      afterPaint(() => {
        const el = document.getElementById(`branch-${focus}`)
        if (el && dialog.current) {
          dialog.current.scrollTo({ top: el.getBoundingClientRect().top + dialog.current.scrollTop - 72, behavior: 'instant' })
          flash(el)
        }
      })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, focus])
  const go = (e: MouseEvent<HTMLAnchorElement>, to: string) => {
    e.preventDefault()
    location.replace(detailHash(to)) // 이전·다음은 기록을 쌓지 않음 → 뒤로 가기 한 번이면 목록
  }
  const title = p.detailTitle ?? p.title
  const diagrams = (p.blocks ?? []).filter((b) => b.type !== 'text')
  const texts = (p.blocks ?? []).filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
  const plan = [...(roadmapByPledge.get(p.id) ?? [])].sort((a, b) => roadmap.periods.indexOf(a.period) - roadmap.periods.indexOf(b.period))
  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="detail-title" className="detail fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-white text-ink">
      <div className="gutter sticky top-0 z-10 border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-[720px] items-center justify-between">
          <a
            href={from === 'roadmap' ? '#roadmap' : `#${c.id}`}
            onClick={(e) => {
              e.preventDefault()
              onClose()
            }}
            className="back -ml-2 flex items-center gap-1 rounded-lg px-2 py-2 text-[15px] font-semibold"
          >
            <ChevronLeft className="size-5" aria-hidden />
            {from === 'roadmap' ? '월별 추진 일정으로' : `${c.name} 목록으로`}
          </a>
          <button type="button" onClick={() => share(`${title} | ${campaign.name}`, detailHash(p.id))} className="back -mr-2 flex items-center gap-1.5 rounded-lg px-2 py-2 text-[15px] font-semibold">
            <Share2 className="size-[18px]" aria-hidden />
            공유
          </button>
        </div>
      </div>
      <article className="gutter pb-20">
        <div className="mx-auto max-w-[720px] pt-7 sm:pt-10">
          <p className="t-small flex items-center gap-2 text-muted">
            <span>
              {c.num} {c.name}
            </span>
            {p.core && <span className="flow-tag">메인공약</span>}
          </p>
          <h2 id="detail-title" ref={heading} tabIndex={-1} className="t-detail mt-2.5 outline-none">
            {title}
          </h2>
          {p.promise && <p className="t-promise mt-5">{p.promise}</p>}
          <div className="mt-7 border-t border-ink" />
          {diagrams.map((b, k) => (
            <section key={k} className="mt-8">
              {b.type === 'flow' ? <Flow steps={b.steps} loop={b.loop} /> : b.type === 'branches' ? <Branches branches={b.branches} /> : null}
            </section>
          ))}
          {texts.map((t, k) => (
            <section key={k} className="mt-11">
              {t.title && <h3 className="t-h3">{t.title}</h3>}
              <div className={`${t.title ? 'mt-3' : ''} space-y-3`}>
                {t.paragraphs.map((x, j) => (
                  <p key={j} className="t-body text-body">
                    {x}
                  </p>
                ))}
              </div>
            </section>
          ))}
          {plan.length > 0 && (
            <section className="mt-11">
              <h3 className="t-h3">월별 추진 일정</h3>
              <dl className="mt-3 border-t border-ink">
                {plan.map((e) => (
                  <div key={e.period + e.text} className="grid grid-cols-[5.5rem_1fr] border-b border-line py-2.5">
                    <dt className="t-small font-bold text-ink">{e.period}</dt>
                    <dd className="t-small text-body">{e.text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {(prev || next) && (
            <nav aria-label="다른 메인공약" className="mt-16 grid border-t border-ink sm:grid-cols-2">
              {prev ? (
                <a href={detailHash(prev.id)} onClick={(e) => go(e, prev.id)} className="row -mx-2 border-b border-line px-2 py-4 sm:border-b-0">
                  <span className="t-meta flex items-center gap-0.5 text-muted">
                    <ChevronLeft className="-ml-1 size-4" aria-hidden />
                    이전 메인공약
                  </span>
                  <span className="t-pledge mt-0.5 block">{prev.title}</span>
                </a>
              ) : (
                <span className="hidden sm:block" />
              )}
              {next && (
                <a href={detailHash(next.id)} onClick={(e) => go(e, next.id)} className="row -mx-2 px-2 py-4 sm:text-right">
                  <span className="t-meta flex items-center gap-0.5 text-muted sm:justify-end">
                    다음 메인공약
                    <ChevronRight className="-mr-1 size-4" aria-hidden />
                  </span>
                  <span className="t-pledge mt-0.5 block">{next.title}</span>
                </a>
              )}
            </nav>
          )}
        </div>
      </article>
    </div>
  )
}

/* 목록·일정 → 상세 → 뒤로: 브라우저 뒤로 가기와 '목록으로' 모두 연 자리로 돌아오고, 누른 줄에 포커스와 표시 */
function useDetailRoute() {
  const [id, setId] = useState(readDetail)
  const current = useRef(id)
  useEffect(() => {
    const onHash = () => {
      const nextId = readDetail()
      const closing = current.current && !nextId ? current.current : null
      current.current = nextId
      setId(nextId)
      if (!closing) return
      afterPaint(() => {
        if (nav.fromList) window.scrollTo({ top: nav.scrollY, behavior: 'instant' })
        else document.getElementById(pledgeIndex.get(closing)!.c.id)?.scrollIntoView({ behavior: 'instant' })
        const row = nav.opener?.isConnected && nav.opener.offsetParent ? nav.opener : document.querySelector<HTMLElement>(`#pledges [data-pledge="${closing}"]`)
        if (row) {
          const r = row.getBoundingClientRect()
          if (r.top < 64 || r.bottom > window.innerHeight) row.scrollIntoView({ block: 'center', behavior: 'instant' })
          row.focus({ preventScroll: true })
          flash(row)
        }
        nav.fromList = false
        nav.opener = null
      })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const close = useCallback(() => {
    if (nav.fromList) return history.back()
    const entry = current.current && pledgeIndex.get(current.current)
    history.replaceState(null, '', entry ? `#${entry.c.id}` : '#pledges')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [])
  return [id, close] as const
}

/* 22면 투표 안내 */
function Vote() {
  const rows = [
    ['투표 기간', vote.period],
    ['투표 시간', vote.time],
    ['투표 방법', vote.method],
  ]
  return (
    <section id="vote" aria-labelledby="vote-title" className="cover-bg gutter relative scroll-mt-14 overflow-hidden pt-16 sm:pt-24 lg:pt-28">
      <div className="wrap relative z-10 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:items-start lg:gap-16">
        <div>
          <h2 id="vote-title" className="t-h2">
            여러분의 소중한 한 표가
            <span className="mt-2 flex items-end gap-x-2">
              <img src="figma/slogan-final.png" alt={campaign.slogan} width={994} height={212} loading="lazy" className="h-auto w-[min(50vw,360px)]" />
              <span className="shrink-0">이 됩니다.</span>
            </span>
          </h2>
        </div>
        <div className="mt-10 lg:mt-0">
          {dday && (
            <p className="mb-6 flex items-end gap-4">
              <span className="t-num text-orange">{dday.mark}</span>
              <span className="t-lead pb-1.5 text-white/85">{dday.text}</span>
            </p>
          )}
          <dl className="border-b border-white/25">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[5.25rem_1fr] items-baseline border-t border-white/25 py-4">
                <dt className="t-small text-white/60">{k}</dt>
                <dd className="t-lead font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={() => share(document.title)} className="cta btn btn-line mt-8 gap-2">
            <Share2 className="size-[18px]" aria-hidden />
            이 페이지 공유하기
          </button>
        </div>
      </div>
      <img src="figma/campus-lineart.webp" alt="" width={1080} height={618} loading="lazy" className="relative mx-auto mt-8 h-auto w-full max-w-[1000px] opacity-60" />
    </section>
  )
}

function Footer() {
  return (
    <footer className="gutter border-t border-white/10 bg-[#07061f] py-10 text-white/65">
      <div className="wrap">
        <div className="flex items-end justify-between gap-4">
          <div className="t-meta">
            <p>{campaign.org}</p>
            <p className="mt-1">
              선거 구호 <span className="text-white/90">{campaign.officialSlogan}</span>
            </p>
          </div>
          <a href="#top" aria-label="맨 위로">
            <img src="figma/logo-white.svg" alt="" className="logo h-6 w-auto" />
          </a>
        </div>
      </div>
    </footer>
  )
}

export default function App() {
  const [detail, closeDetail] = useDetailRoute()
  return (
    <MotionConfig reducedMotion="user">
      <div inert={!!detail} aria-hidden={detail ? true : undefined}>
        <Header />
        <main>
          <Hero />
          <Candidates />
          <Slogan />
          <Statement />
          <Pledges />
          <Roadmap />
          <Vote />
        </main>
        <Footer />
      </div>
      {detail && <PledgeDetail key={detail} id={detail} onClose={closeDetail} />}
      <Toaster position="bottom-center" toastOptions={{ unstyled: true, className: 'toast' }} />
    </MotionConfig>
  )
}
