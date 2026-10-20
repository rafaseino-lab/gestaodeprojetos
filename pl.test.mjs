// ─────────────────────────────────────────────────────────────────────────
// Testes dos cálculos financeiros do sistema (modelo DONA DO DEAL).
//
// Como rodar:   node tests/pl.test.mjs
//
// O teste EXTRAI a função `plOwner` de dentro do index.html e roda asserções
// contra ela — ou seja, valida o CÓDIGO REAL que está no ar, não uma cópia.
// plOwner é a FONTE ÚNICA de cálculo de investido/lucro/ROI: Financeiro,
// DRE, Início, Imóvel & Finanças e o relatório PDF passam todos por ela.
//
// Se algum dia alguém mudar a fórmula (ex.: tirar a obra do investido, que já
// causou "lucro inflado" 3x), estes testes QUEBRAM antes de ir pro cliente.
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

// Extrai o corpo de `function plOwner(i){ ... }` casando as chaves.
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Função ' + name + ' não encontrada no index.html');
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const plOwnerSrc = extractFn(html, 'plOwner');
// eval isolado: define a função e devolve ela
const plOwner = new Function(plOwnerSrc + '\nreturn plOwner;')();

// ── mini runner ──
let pass = 0, fail = 0;
const approx = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
function check(name, cond, got, exp) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → obtido: ' + JSON.stringify(got) + ' | esperado: ' + JSON.stringify(exp)); }
}

console.log('\nplOwner — modelo dona do deal\n');

// 1) MODELO · 4821 Lake Nona Blvd (o projeto de exemplo real)
{
  const r = plOwner({ cash: 450000, otherAcq: 5000, obra: 158000, sale: 820000, selling: 49200 });
  check('MODELO: total investido = 613.000', r.totalInvested === 613000, r.totalInvested, 613000);
  check('MODELO: lucro bruto = 770.800', r.grossProfit === 770800, r.grossProfit, 770800);
  check('MODELO: lucro líquido = 157.800', r.netProfit === 157800, r.netProfit, 157800);
  check('MODELO: ROI ≈ 25,7%', approx(r.roi, 25.742), r.roi.toFixed(2), '25.74');
}

// 2) Compra à vista, sem obra
{
  const r = plOwner({ cash: 100000, sale: 150000 });
  check('Cash simples: investido = 100.000', r.totalInvested === 100000, r.totalInvested, 100000);
  check('Cash simples: lucro = 50.000', r.netProfit === 50000, r.netProfit, 50000);
  check('Cash simples: ROI = 50%', r.roi === 50, r.roi, 50);
}

// 3) Deal com prejuízo
{
  const r = plOwner({ cash: 500000, obra: 100000, sale: 550000, selling: 10000 });
  check('Prejuízo: investido = 600.000', r.totalInvested === 600000, r.totalInvested, 600000);
  check('Prejuízo: lucro líquido = -60.000', r.netProfit === -60000, r.netProfit, -60000);
  check('Prejuízo: ROI = -10%', r.roi === -10, r.roi, -10);
}

// 4) GUARDA ANTI-REGRESSÃO: a OBRA tem que entrar no investido.
//    (Se alguém tirar a obra da conta, o lucro volta a inflar pra 315.800.)
{
  const comObra = plOwner({ cash: 450000, otherAcq: 5000, obra: 158000, sale: 820000, selling: 49200 });
  const semObra = plOwner({ cash: 450000, otherAcq: 5000, obra: 0, sale: 820000, selling: 49200 });
  check('Obra entra no investido (com ≠ sem)', comObra.netProfit !== semObra.netProfit, comObra.netProfit, '≠ ' + semObra.netProfit);
  check('Obra reduz o lucro em exatamente o valor da obra', semObra.netProfit - comObra.netProfit === 158000, semObra.netProfit - comObra.netProfit, 158000);
  check('Sem obra o lucro INFLA pra 315.800 (bug antigo)', semObra.netProfit === 315800, semObra.netProfit, 315800);
}

// 5) Projeto ainda não vendido → sem lucro/ROI projetado aqui
{
  const r = plOwner({ cash: 450000, obra: 100000, sale: 0 });
  check('Sem venda: lucro = 0', r.netProfit === 0, r.netProfit, 0);
  check('Sem venda: ROI = 0', r.roi === 0, r.roi, 0);
}

// 6) INVARIANTE do DRE: Receita − CMV == Lucro líquido.
//    (O DRE calcula CMV = investido + custos de venda + custos do credor.)
{
  const i = { cash: 450000, otherAcq: 5000, obra: 158000, sale: 820000, selling: 49200, lenderSale: 3000 };
  const r = plOwner(i);
  const cmv = r.totalInvested + i.selling + i.lenderSale;
  check('DRE: Receita − CMV == Lucro líquido', (i.sale - cmv) === r.netProfit, i.sale - cmv, r.netProfit);
}

console.log('\n' + (fail === 0 ? '✅ TODOS OS TESTES PASSARAM' : '❌ ' + fail + ' teste(s) falharam') + '  (' + pass + ' ok)\n');
process.exit(fail === 0 ? 0 : 1);
