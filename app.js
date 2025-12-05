const ui = {
  livro: document.getElementById('livro'),
  capitulo: document.getElementById('capitulo'),
  verso: document.getElementById('verso'),
  buscar: document.getElementById('buscar'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  ref: document.querySelector('#resultado .ref'),
  texto: document.querySelector('#resultado .texto'),
  erro: document.getElementById('erro'),
  copiar: document.getElementById('copiar'),
  abrirJson: document.getElementById('abrirJson'),
  arquivoJson: document.getElementById('arquivoJson')
  , query: document.getElementById('query')
  , buscarTexto: document.getElementById('buscarTexto')
  , apenasLivro: document.getElementById('apenasLivro')
  , listaResultados: document.getElementById('listaResultados')
  , statusBusca: document.getElementById('statusBusca')
  , micBtn: document.getElementById('micBtn')
  , fullscreenBtn: document.getElementById('fullscreenBtn')
  , fsScale: document.getElementById('fsScale')
  , fsScaleLabel: document.getElementById('fsScaleLabel')
}

let dados = []
let mapa = new Map()
let ultimosResultados = []
let fsOverlay = null, fsBox = null, fsText = null, fsResizeHandler = null, fsKeyHandler = null, fsRef = null
let fsBaseSize = 0, fsScalePercent = 100

function instalarDados(j) {
  if (!Array.isArray(j) || j.length === 0) {
    throw new Error('JSON inválido: não é uma lista de livros')
  }
  dados = j
  preencherLivros()
  ui.livro.selectedIndex = 0
  ui.capitulo.value = 1
  ui.verso.value = 1
  mostrar()
}

async function carregar() {
  ui.erro.hidden = true
  try {
    const r = await fetch('biblias/ARA.json')
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = await r.json()
    instalarDados(j)
  } catch (e) {
    ui.erro.textContent = 'Não foi possível carregar biblias/ARA.json. Clique em “Abrir JSON…” e selecione o arquivo, ou arraste-o para a página.'
    ui.erro.hidden = false
  }
}

function preencherLivros() {
  ui.livro.innerHTML = ''
  dados.forEach((b, i) => {
    const nome = b.name ? `${b.abbrev} — ${b.name}` : b.abbrev
    const opt = document.createElement('option')
    opt.value = b.abbrev
    opt.textContent = nome
    opt.dataset.index = i
    ui.livro.appendChild(opt)
    mapa.set(b.abbrev, i)
    if (b.name) mapa.set(b.name.toLowerCase(), i)
  })
}

function obterSelecionado() {
  const i = ui.livro.selectedOptions[0]?.dataset.index
  return dados[Number(i) || 0]
}

function validar(livro, cap, ver) {
  if (!livro) return 'Livro inválido'
  const totalCap = livro.chapters.length
  if (cap < 1 || cap > totalCap) return `Capítulo fora do intervalo (1–${totalCap})`
  const totalVer = livro.chapters[cap - 1].length
  if (ver < 1 || ver > totalVer) return `Verso fora do intervalo (1–${totalVer})`
  return null
}

function mostrar() {
  const livro = obterSelecionado()
  const cap = Number(ui.capitulo.value)
  const ver = Number(ui.verso.value)
  const err = validar(livro, cap, ver)
  if (err) { ui.erro.textContent = err; ui.erro.hidden = false; return }
  ui.erro.hidden = true
  const texto = livro.chapters[cap - 1][ver - 1]
  ui.ref.textContent = `${livro.abbrev} ${cap}:${ver}`
  ui.texto.textContent = texto
  if (fsOverlay && fsText) { fsText.textContent = ui.texto.textContent; if (fsRef) fsRef.textContent = ui.ref.textContent; ajustarFonteFs() }
}

ui.buscar.addEventListener('click', mostrar)
ui.prev.addEventListener('click', () => {
  let v = Number(ui.verso.value)
  if (v > 1) { ui.verso.value = String(v - 1); mostrar() }
})
ui.next.addEventListener('click', () => {
  const livro = obterSelecionado()
  const cap = Number(ui.capitulo.value)
  let v = Number(ui.verso.value)
  const total = livro.chapters[cap - 1].length
  if (v < total) { ui.verso.value = String(v + 1); mostrar() }
})
ui.copiar.addEventListener('click', async () => {
  const ref = ui.ref.textContent
  const tx = ui.texto.textContent
  try { await navigator.clipboard.writeText(`${ref} — ${tx}`) } catch { }
})

// Abertura manual do JSON
ui.abrirJson?.addEventListener('click', () => ui.arquivoJson.click())
ui.arquivoJson?.addEventListener('change', () => {
  const f = ui.arquivoJson.files?.[0]
  if (!f) return
  const fr = new FileReader()
  fr.onload = () => {
    try { instalarDados(JSON.parse(fr.result)) } catch (e) {
      ui.erro.textContent = 'Arquivo JSON inválido'; ui.erro.hidden = false
    }
  }
  fr.readAsText(f, 'utf-8')
})

// Suporte a arrastar e soltar
document.addEventListener('dragover', e => { e.preventDefault() })
document.addEventListener('drop', e => {
  e.preventDefault()
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  const fr = new FileReader()
  fr.onload = () => {
    try { instalarDados(JSON.parse(fr.result)) } catch (e) {
      ui.erro.textContent = 'Arquivo JSON inválido'; ui.erro.hidden = false
    }
  }
  fr.readAsText(f, 'utf-8')
})

// Busca textual aproximada
function norm(s) { return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() }
function temPalavraChave(n) { return /\b(ta|esta)\s+escrito\b/.test(n) }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
const STOP = new Set(['o', 'os', 'a', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'que', 'se', 'nos', 'vos', 'eu', 'e'])
function splitWords(s) { return s.split(/[^a-z0-9]+/).filter(Boolean) }
function lev(a, b, limit) { const la = a.length, lb = b.length; if (Math.abs(la - lb) > limit) return limit + 1; const dp = new Array(lb + 1); for (let j = 0; j <= lb; j++) dp[j] = j; for (let i = 1; i <= la; i++) { let prev = dp[0]; dp[0] = i; let rowMin = dp[0]; for (let j = 1; j <= lb; j++) { const cost = a[i - 1] === b[j - 1] ? 0 : 1; const val = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost); prev = dp[j]; dp[j] = val; if (val < rowMin) rowMin = val } if (rowMin > limit) return limit + 1 } return dp[lb] }
function matchToken(words, t) { const lim = t.length >= 8 ? 2 : 1; for (let i = 0; i < words.length; i++) { const w = words[i]; if (w === t) return true; const ml = Math.min(w.length, t.length); if (ml >= 4 && (w.includes(t) || t.includes(w))) return true; if (lev(w, t, lim) <= lim) return true } return false }
function spanOrderWords(words, toks) { let pos = -1, start = -1, end = -1; for (let i = 0; i < toks.length; i++) { const t = toks[i]; let found = -1; for (let j = pos + 1; j < words.length; j++) { if (matchToken([words[j]], t)) { found = j; break } } if (found < 0) return Infinity; if (i === 0) start = found; end = found; pos = found } return end - start }
function buscarPorTexto() {
  const q = norm(ui.query.value).trim()
  if (q.length < 2) { ui.statusBusca.textContent = 'Digite pelo menos 2 caracteres'; ui.listaResultados.innerHTML = ''; return }
  const tokens = q.split(/\s+/).filter(t => t && !STOP.has(t))
  const escopo = ui.apenasLivro?.checked ? [obterSelecionado()] : dados
  const resultados = []
  escopo.forEach(b => {
    for (let ci = 0; ci < b.chapters.length; ci++) {
      const cap = b.chapters[ci]
      for (let vi = 0; vi < cap.length; vi++) {
        const texto = cap[vi]
        const nt = norm(texto)
        const words = splitWords(nt)
        const ok = tokens.every(t => matchToken(words, t))
        if (ok) resultados.push({ livro: b.abbrev, cap: ci + 1, ver: vi + 1, texto })
      }
    }
  })
  const rxPhrase = new RegExp(tokens.map(t => escRe(t)).join('\\W+'))
  const ranked = resultados.map(r => {
    const nt = norm(r.texto)
    const words = splitWords(nt)
    const phrase = rxPhrase.test(nt) ? 1 : 0
    const span = spanOrderWords(words, tokens)
    return { r, phrase, span }
  })
  ranked.sort((a, b) => (b.phrase - a.phrase) || (a.span - b.span) || (a.r.texto.length - b.r.texto.length))
  ultimosResultados = ranked.map(x => x.r)
  ui.statusBusca.textContent = `${resultados.length} resultado(s)`
  ui.listaResultados.innerHTML = ''
  const max = Math.min(ultimosResultados.length, 200)
  for (let i = 0; i < max; i++) {
    const r = ultimosResultados[i]
    const li = document.createElement('li')
    const ref = document.createElement('span'); ref.className = 'li-ref'; ref.textContent = `${r.livro} ${r.cap}:${r.ver}`
    const tx = document.createElement('span'); tx.className = 'li-texto'; tx.textContent = r.texto
    li.appendChild(ref); li.appendChild(tx)
    li.addEventListener('click', () => { ui.capitulo.value = r.cap; ui.verso.value = r.ver; const idx = mapa.get(r.livro); if (idx != null) ui.livro.selectedIndex = idx; mostrar() })
    ui.listaResultados.appendChild(li)
  }
  atualizarFsComTopo()
}
ui.buscarTexto?.addEventListener('click', buscarPorTexto)
ui.query?.addEventListener('keydown', e => { if (e.key === 'Enter') buscarPorTexto() })

let recognition = null
let micOn = false
let voiceDebounce = null
let lastVoiceAction = 0
let voiceCmdLock = false

function suporteVoz() {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
}
function criarRecon() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  const r = new Ctor()
  r.lang = 'pt-BR'
  r.interimResults = true
  r.continuous = true
  r.maxAlternatives = 1
  const CMD_GAP = 300
  function parseNumeroFalado(s, fin) {
    const ds = s.match(/\b([1-9]\d?)\b/g)
    if (ds && ds.length) {
      let two = null
      for (let i = 0; i < ds.length; i++) { const m = ds[i]; if (m.length === 2) two = Number(m) }
      if (two != null) return two
      if (fin) return Number(ds[ds.length - 1])
      return null
    }
    const toks = s.split(/[^a-z0-9]+/).filter(Boolean)
    const UN = { um: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9 }
    const TEENS = { dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 }
    const TENS = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 }
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (TEENS[t] !== undefined) {
        if (t === 'dez' && !fin) continue
        return TEENS[t]
      }
      if (TENS[t] !== undefined) {
        let val = TENS[t]
        const t2 = toks[i + 1]
        const t3 = toks[i + 2]
        if (t2 === 'e' && UN[t3] !== undefined) { val += UN[t3]; return val }
        if (UN[t2] !== undefined) { val += UN[t2]; return val }
        if (fin) return val
        continue
      }
      if (UN[t] !== undefined) {
        if (fin) return UN[t]
        continue
      }
    }
    return null
  }
  function forcarRestart() {
    try { r.stop() } catch { }
    setTimeout(() => { if (micOn) try { r.start() } catch { } }, 250)
  }
  r.onresult = e => {
    const res = e.results[e.results.length - 1]
    const chunk = res && res[0] ? res[0].transcript : ''
    const n = norm(chunk)
    const fin = !!(res && res.isFinal)
    const goto = /\b(va|vai|vá|ir)\s+(pra|pru|pro|para)\s+(o\s+)?(verso|versiculo)\b/.test(n)
    if (/\bfrente\b/.test(n)) {
      if (!fin) return
      const now = Date.now(); if (voiceCmdLock || (now - lastVoiceAction < CMD_GAP)) return; voiceCmdLock = true; lastVoiceAction = now
      ui.statusBusca.textContent = 'Voz: próximo verso'
      try { ui.next.click() } catch { }
      setTimeout(() => { voiceCmdLock = false }, 500)
      return
    }
    if (/\b(tras|traz|atras|para\s+tras|para\s+traz|pra\s+tras|pra\s+traz)\b/.test(n)) {
      if (!fin) return
      const now = Date.now(); if (voiceCmdLock || (now - lastVoiceAction < CMD_GAP)) return; voiceCmdLock = true; lastVoiceAction = now
      ui.statusBusca.textContent = 'Voz: verso anterior'
      try { ui.prev.click() } catch { }
      setTimeout(() => { voiceCmdLock = false }, 500)
      return
    }
    const numCap = goto ? parseNumeroFalado(n, fin) : null
    if (numCap != null) {
      const livro = obterSelecionado()
      const cap = Number(ui.capitulo.value)
      const total = livro && livro.chapters && livro.chapters[cap - 1] ? livro.chapters[cap - 1].length : 0
      const v = Number(numCap)
      if (v >= 1 && v <= 99 && v <= total) {
        const now = Date.now(); if (voiceCmdLock || (now - lastVoiceAction < CMD_GAP)) return; voiceCmdLock = true; lastVoiceAction = now
        ui.statusBusca.textContent = `Voz: ir para verso ${v}`
        ui.verso.value = String(v)
        mostrar()
        setTimeout(() => { voiceCmdLock = false }, 500)
        return
      }
    }
    const m = n.match(/\b(ta|esta)\s+escrito\b[\s,:-]*(.*)/)
    if (m && m[1]) {
      const q = (m[2] || m[1]).trim()
      if (q) {
        ui.query.value = q
        ui.statusBusca.textContent = `Voz: buscando “${q}”`
        if (voiceDebounce) try { clearTimeout(voiceDebounce) } catch { }
        voiceDebounce = setTimeout(() => { buscarPorTexto() }, 100)
      }
    }
  }
  r.onend = () => { if (micOn) try { r.start() } catch { } }
  r.onerror = () => { }
  return r
}
function toggleMic() {
  if (!suporteVoz()) { ui.statusBusca.textContent = 'Seu navegador não suporta reconhecimento de voz'; return }
  micOn = !micOn
  ui.micBtn.classList.toggle('on', micOn)
  if (micOn) { if (!recognition) recognition = criarRecon(); try { recognition.start() } catch { } }
  else { try { recognition.stop() } catch { } }
}
ui.micBtn?.addEventListener('click', toggleMic)

function ajustarFonteFs() {
  if (!fsText || !fsBox) return
  let low = 12, high = 2000, best = 12
  for (let i = 0; i < 20; i++) {
    const mid = Math.floor((low + high) / 2)
    fsText.style.fontSize = mid + 'px'
    const ok = fsText.scrollWidth <= fsBox.clientWidth && fsText.scrollHeight <= fsBox.clientHeight
    if (ok) { best = mid; low = mid + 1 } else { high = mid - 1 }
  }
  fsBaseSize = best
  aplicarEscalaFs()
}

function atualizarFsComTopo() {
  if (!fsOverlay || !fsText) return
  const r0 = ultimosResultados && ultimosResultados.length ? ultimosResultados[0] : null
  const texto = r0 ? r0.texto : ''
  if (!texto) return
  if (r0) {
    const idx = mapa.get(r0.livro)
    if (idx != null) ui.livro.selectedIndex = idx
    ui.capitulo.value = r0.cap
    ui.verso.value = r0.ver
    mostrar()
  }
}

// Fullscreen do verso do topo
function abrirFullscreenVerso() {
  const r0 = ultimosResultados && ultimosResultados.length ? ultimosResultados[0] : null
  const texto = r0 ? r0.texto : (ui.texto.textContent || '')
  if (!texto) { ui.statusBusca.textContent = 'Nenhum verso disponível'; return }
  if (r0) {
    const idx = mapa.get(r0.livro)
    if (idx != null) ui.livro.selectedIndex = idx
    ui.capitulo.value = r0.cap
    ui.verso.value = r0.ver
    mostrar()
  }
  if (!fsOverlay) {
    fsOverlay = document.createElement('div')
    fsOverlay.className = 'fs-overlay'
    fsBox = document.createElement('div')
    fsBox.className = 'fs-box'
    fsText = document.createElement('div')
    fsText.className = 'fs-text'
    fsRef = document.createElement('div')
    fsRef.className = 'fs-ref'
    fsBox.appendChild(fsText)
    fsOverlay.appendChild(fsBox)
    const refTxt = ui.ref.textContent || ''
    fsRef.textContent = refTxt
    fsOverlay.appendChild(fsRef)
    document.body.appendChild(fsOverlay)
    const fechar = () => { try { document.exitFullscreen() } catch { }; if (fsResizeHandler) window.removeEventListener('resize', fsResizeHandler); if (fsKeyHandler) document.removeEventListener('keydown', fsKeyHandler); if (fsOverlay) { fsOverlay.remove(); fsOverlay = null; fsBox = null; fsText = null; fsResizeHandler = null; fsKeyHandler = null; fsRef = null } }
    fsOverlay.addEventListener('click', fechar)
    fsKeyHandler = (e) => { if (e.key === 'Escape') fechar() }
    document.addEventListener('keydown', fsKeyHandler)
    fsResizeHandler = () => ajustarFonteFs()
    window.addEventListener('resize', fsResizeHandler)
    try { fsOverlay.requestFullscreen().catch(() => { }) } catch { }
  }
  fsText.textContent = ui.texto.textContent || texto
  if (fsRef) fsRef.textContent = ui.ref.textContent || fsRef.textContent
  ajustarFonteFs()
}

function aplicarEscalaFs() {
  if (!fsText || !fsBox) return
  const desejada = Math.floor(fsBaseSize * fsScalePercent / 100)
  fsText.style.fontSize = desejada + 'px'
  const ok = fsText.scrollWidth <= fsBox.clientWidth && fsText.scrollHeight <= fsBox.clientHeight
  if (!ok) ajustarFonteFs()
}

function setFsScale(p) {
  fsScalePercent = Math.max(50, Math.min(200, Number(p) || 100))
  if (ui.fsScaleLabel) ui.fsScaleLabel.textContent = `${fsScalePercent}%`
  if (fsOverlay) {
    try { fsOverlay.style.padding = fsScalePercent > 100 ? '2vw' : '4vw' } catch { }
    aplicarEscalaFs()
  }
  saveConfig({ fsScalePercent })
}
ui.fsScale?.addEventListener('input', e => setFsScale(e.target.value))
ui.fullscreenBtn?.addEventListener('click', abrirFullscreenVerso)

async function saveConfig(j) {
  try { localStorage.setItem('dyb_config', JSON.stringify(j)) } catch { }
  try { await fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j) }) } catch { }
}

async function carregarConfig() {
  let j = null
  try {
    const r = await fetch('/config')
    if (r.ok) j = await r.json()
  } catch { }
  if (!j) {
    try { j = JSON.parse(localStorage.getItem('dyb_config') || '{}') } catch { j = {} }
  }
  if (typeof j.fsScalePercent === 'number') {
    fsScalePercent = j.fsScalePercent
    if (ui.fsScale) ui.fsScale.value = String(fsScalePercent)
    if (ui.fsScaleLabel) ui.fsScaleLabel.textContent = `${fsScalePercent}%`
  }
}
carregarConfig()
carregar()
