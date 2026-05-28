import { chromium } from 'playwright';
let b; try { b = await chromium.launch(); } catch { b = await chromium.launch({ channel: 'chrome' }); }
const slugs = ['best-lubes','best-anal-lubes','best-penis-pumps','best-anal-sex-toys','best-glass-dildos-and-sex-toys','best-anal-dildo'];
for (const s of slugs) {
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0,120)));
  try {
    await p.goto('https://maleq.com/guides/'+s, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(4000);
    const r = await p.evaluate(() => {
      const ph = document.querySelectorAll('.blog-add-to-cart-placeholder');
      const bodyText = document.body.innerText;
      return {
        ph: ph.length,
        buttons: document.querySelectorAll('.blog-add-to-cart-placeholder button').length,
        unavailable: bodyText.split('Product unavailable').length - 1,
        rawShortcode: (bodyText.match(/\[(add_to_cart|products|product_page|product)\b/g)||[]).length,
        leftoverWooHTML: document.querySelectorAll('p.product.woocommerce, .add_to_cart_button, .wc-block').length,
      };
    });
    console.log(s, JSON.stringify(r), errs.length?('ERR:'+errs[0]):'');
  } catch(e){ console.log(s, 'NAV-FAIL', e.message.slice(0,80)); }
  await p.close();
}
await b.close();
