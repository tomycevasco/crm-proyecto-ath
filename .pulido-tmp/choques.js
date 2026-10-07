async (page) => {
  const salida = {};
  for (const ruta of ['inicio','muro','clientes','github','miespacio','agente','paint']) {
    await page.goto('http://127.0.0.1:5188/#/' + ruta);
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const spec = (sel) => {
        sel = sel.replace(/::?(before|after|placeholder|backdrop|selection|-webkit-[a-z-]+)/g, '');
        let a = 0, b = 0, c = 0;
        sel = sel.replace(/:(not|is|has)\(([^)]*)\)/g, (m, f, inner) => { if (f !== 'is') { const s = spec(inner); a += s[0]; b += s[1]; c += s[2]; } else { const s = spec(inner); a+=s[0]; b+=s[1]; c+=s[2]; } return ''; });
        sel = sel.replace(/:where\([^)]*\)/g, '');
        a += (sel.match(/#[\w-]+/g) || []).length;
        b += (sel.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length;
        c += (sel.replace(/\[[^\]]+\]/g,'').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
        return [a, b, c];
      };
      const reglas = (hoja) => {
        const out = [];
        const rec = (lista) => { for (const r of lista) {
          if (r instanceof CSSMediaRule) { if (matchMedia(r.conditionText).matches) rec(r.cssRules); }
          else if (r instanceof CSSStyleRule) out.push(r);
        } };
        rec(hoja.cssRules); return out;
      };
      const hojas = [...document.styleSheets].map(h => ({ h, id: (h.ownerNode.dataset.viteDevId || '').split('/').pop() }));
      const base = hojas.find(x => x.id === 'base.css');
      const baseReglas = reglas(base.h);
      const res = new Set();
      for (const { h, id } of hojas) {
        if (id === 'base.css') continue;
        for (const R of reglas(h)) {
          for (const selR of R.selectorText.split(',')) {
            let els; try { els = document.querySelectorAll(selR.replace(/::?(before|after|placeholder)/g, '')); } catch { continue; }
            if (/::(before|after)/.test(selR)) continue;
            const sR = spec(selR);
            for (const el of els) for (const B of baseReglas) for (const selB of B.selectorText.split(',')) {
              if (/::(before|after)/.test(selB)) continue;
              let m; try { m = el.matches(selB); } catch { continue; }
              if (!m) continue;
              const sB = spec(selB);
              if (sB.join() !== sR.join()) continue;
              for (const p of R.style) if (B.style.getPropertyValue(p) && B.style.getPropertyValue(p) !== R.style.getPropertyValue(p))
                res.add(`${id}: «${selR.trim()}» ${p} pierde con base «${selB.trim()}»`);
            }
          }
        }
      }
      return [...res];
    });
    salida[ruta] = r;
  }
  return salida;
}
