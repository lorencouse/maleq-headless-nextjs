/**
 * Inject the localized support-chatbot decision-tree text (`chat.tree`) into
 * the Spanish and Traditional-Chinese catalogs.
 *
 * The tree STRUCTURE (ids, types, product-search queries) lives in
 * lib/chatbot/decision-tree.ts and stays language-agnostic. Its English
 * `label`/`answer`/`transition` literals are the canonical source and the
 * runtime fallback — so `en` (and the `ja` placeholder catalog) need no entry
 * here and render straight from the literals. Only the genuinely-translated
 * locales get a `chat.tree` override.
 *
 * Keys are the node's id-PATH (e.g. `orders.track-order.answer`), not a bare
 * id, because ids are only unique within a level (`lube` appears under both
 * `care` and `product-help.audience-universal`). ChatWidget builds the same
 * path from its nav state and looks the value up with t.has() + literal
 * fallback. Markdown links `[text](/path)` keep their path; only visible prose
 * is translated.
 *
 * Simplified Chinese (messages/zh.json) is NOT written here — it is generated
 * from the Traditional catalog by scripts/convert-zh-hant-to-hans.ts. Run that
 * after this script:
 *
 *   bun scripts/add-chatbot-tree-i18n.ts
 *   bun scripts/convert-zh-hant-to-hans.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MESSAGES_DIR = join(import.meta.dir, '..', 'messages');

// --- Spanish ---------------------------------------------------------------
const TREE_ES = {
  orders: {
    label: 'Pedidos y seguimiento',
    'track-order': {
      label: '¿Dónde está mi pedido?',
      answer:
        'Puedes consultar tu pedido de dos formas:\n\n- Con cuenta: [ver tus pedidos](/account/orders)\n- Compra como invitado: usa el [seguimiento de pedidos](/track-order) con tu número de pedido y el correo electrónico que usaste al pagar\n\nEl seguimiento completo se incluye con el envío exprés. Los envíos gratuitos y económicos pueden no incluir seguimiento detallado.',
    },
    'multiple-packages': {
      label: 'Mi pedido llegó en varios paquetes',
      answer:
        'Es normal: enviamos desde varios almacenes en EE. UU., por lo que los pedidos grandes pueden llegar en paquetes separados. Si no has recibido todo al final del plazo de entrega estimado, [contáctanos](/contact) con tu número de pedido.',
    },
    'cancel-order': {
      label: 'Cancelar mi pedido',
      answer:
        'Los pedidos se procesan a lo largo del día, así que solo podemos cancelar los que aún no se hayan enviado. [Contáctanos](/contact) de inmediato con tu número de pedido para intentar la cancelación. Los paquetes ya enviados no se pueden recuperar.',
    },
    'damaged-or-wrong': {
      label: 'Llegó roto o equivocado',
      answer:
        'Lamentamos lo ocurrido: reembolsamos o reemplazamos los artículos defectuosos y corregimos cualquier error de envío. [Contáctanos](/contact) con:\n\n- Tu número de pedido\n- Una breve descripción del problema\n- Fotos del daño\n- Conserva todo el material de embalaje',
    },
  },
  shipping: {
    label: 'Envíos y entrega',
    'shipping-times': {
      label: '¿Cuánto tarda el envío?',
      answer:
        'Los tiempos de envío varían según la modalidad: las estimaciones aparecen junto a cada opción al pagar y en tu recibo. Todos los plazos son en días hábiles (sin fines de semana ni festivos), según las estimaciones de UPS/USPS. Consulta [Envíos y devoluciones](/shipping-returns) para más detalles.',
    },
    international: {
      label: '¿Hacen envíos internacionales?',
      answer:
        'Sí: enviamos a muchos países de todo el mundo. Las opciones internacionales y sus estimaciones aparecen al pagar. Si tu pedido internacional no llega dentro del plazo estimado, cubriremos la diferencia hasta la siguiente modalidad de envío.',
    },
    discreet: {
      label: '¿El envío es discreto?',
      answer:
        'Sí. Todos los artículos se envían en embalaje sencillo y sin marcas, sin ninguna indicación del contenido. El remitente aparece como **CNV** o **TMQ**. Para la aduana internacional, los artículos se declaran como «Health Equipment», «Cosmetic» o «Gift». Más información en la [página de Envíos y devoluciones](/shipping-returns).',
    },
    'tracking-number': {
      label: '¿Recibiré un número de seguimiento?',
      answer:
        'El envío exprés incluye seguimiento completo. Los envíos gratuitos y económicos pueden no incluir seguimiento detallado. Siempre puedes consultar el estado desde [tu cuenta](/account/orders) o el [seguimiento de pedidos](/track-order).',
    },
    'billing-statement': {
      label: '¿Qué nombre aparece en mi estado de cuenta?',
      answer:
        'Las compras aparecen como **TMQ LLC** en el estado de cuenta de tu tarjeta de débito o crédito. Nunca revelamos qué se compró en el propio estado de cuenta.',
    },
  },
  returns: {
    label: 'Devoluciones y reembolsos',
    'return-policy': {
      label: '¿Cuál es su política de devoluciones?',
      answer:
        'Por motivos de higiene, **todas las ventas son definitivas**. Solo ofrecemos reembolsos o reemplazos en caso de:\n\n- Artículos enviados por error\n- Artículos dañados a la llegada\n\nRevisa los artículos cuanto antes. Política completa en [Envíos y devoluciones](/shipping-returns).',
    },
    'damaged-return': {
      label: 'Mi artículo llegó dañado',
      answer:
        'Lo reembolsamos o lo reemplazamos. [Contáctanos](/contact) con tu número de pedido y fotos del daño, y conserva todo el material de embalaje.',
    },
    'bounced-package': {
      label: 'Mi paquete fue rechazado o devuelto',
      answer:
        'Los envíos devueltos, no entregables o rechazados están sujetos a una tarifa de reposición del 10 %. Los gastos de envío de artículos ya enviados no son reembolsables.',
    },
  },
  payment: {
    label: 'Pago y facturación',
    'payment-methods': {
      label: '¿Qué métodos de pago aceptan?',
      answer:
        'Todas las principales tarjetas de crédito (Visa, MasterCard, American Express, Discover), Apple Pay y Google Pay, todo a través de nuestro pago con tecnología de Stripe.',
    },
    'payment-plans': {
      label: '¿Ofrecen planes de pago?',
      answer:
        'Sí: Afterpay y Klarna están disponibles al pagar para pedidos que reúnan los requisitos, lo que te permite dividir las compras en cuotas sin intereses. Aparecen automáticamente durante el pago.',
    },
    declined: {
      label: 'Mi pago fue rechazado',
      answer:
        'Causas habituales: datos incorrectos de la tarjeta, fondos insuficientes o la protección antifraude de tu banco. Verifica tus datos e inténtalo de nuevo, o llama a tu banco. Si el problema continúa, [contáctanos](/contact).',
    },
    'international-currency': {
      label: '¿Aceptan monedas internacionales?',
      answer:
        'Sí. Los precios se muestran en USD; tu banco cobra en tu moneda local según su tipo de cambio. Pueden añadir comisiones por transacción internacional; consulta los detalles con tu banco.',
    },
    'payment-secure': {
      label: '¿Mi información de pago está segura?',
      answer:
        'Sí. Usamos cifrado SSL estándar del sector y Stripe gestiona todo el procesamiento de pagos (conforme a PCI). Nunca almacenamos los datos completos de tu tarjeta de crédito en nuestros servidores.',
    },
  },
  account: {
    label: 'Cuenta e inicio de sesión',
    'reset-password': {
      label: 'Olvidé mi contraseña',
      answer:
        'Ve a [Olvidé mi contraseña](/forgot-password), introduce tu correo electrónico y te enviaremos un enlace para restablecerla. Revisa tu carpeta de spam si no aparece en unos minutos.',
    },
    'need-account': {
      label: '¿Necesito una cuenta?',
      answer:
        'No: la compra como invitado funciona perfectamente. Una cuenta te da historial de pedidos, direcciones guardadas, listas de deseos y un seguimiento más fácil. [Regístrate aquí](/register) si quieres una.',
    },
    coupon: {
      label: '¿Cómo uso un código de cupón?',
      answer:
        'Introduce el código en el campo de la [página del carrito](/cart) o durante el pago y haz clic en **Aplicar**. Solo se permite un cupón por pedido.',
    },
  },
  'product-help': {
    label: 'Encontrar un producto / recomendaciones',
    'audience-male': {
      label: 'Para él',
      'cock-rings': { label: 'Anillos para el pene' },
      prostate: { label: 'Masajeadores de próstata' },
      masturbators: { label: 'Masturbadores y estimuladores' },
      'penis-pumps': { label: 'Bombas de succión para el pene' },
      sleeves: { label: 'Fundas y extensiones' },
    },
    'audience-female': {
      label: 'Para ella',
      'clit-vibes': { label: 'Vibradores de clítoris' },
      gspot: { label: 'Juguetes para el punto G' },
      rabbits: { label: 'Vibradores tipo conejo' },
      suction: { label: 'Succión / pulso de aire' },
      wands: { label: 'Masajeadores tipo varita' },
    },
    'audience-universal': {
      label: 'Universal / parejas',
      anal: { label: 'Juguetes anales' },
      dildos: { label: 'Consoladores' },
      bondage: { label: 'Bondage y BDSM' },
      strapons: { label: 'Arneses y dildos con arnés' },
      lube: { label: 'Lubricantes' },
      condoms: { label: 'Preservativos' },
    },
  },
  care: {
    label: 'Cuidado del producto y compatibilidad',
    cleaning: {
      label: '¿Cómo limpio mi producto?',
      answer:
        'La mayoría de los productos: agua tibia y jabón antibacteriano suave (o un limpiador específico para juguetes), antes y después de cada uso. Consulta siempre las instrucciones específicas del producto y evita los productos químicos agresivos.',
    },
    storage: {
      label: '¿Cómo debo guardar mis productos?',
      answer:
        'En un lugar fresco y seco, sin luz solar directa. Guarda los artículos de silicona por separado (pueden reaccionar con otros materiales). Evita las bolsas de plástico, ya que retienen la humedad. Muchos productos incluyen una bolsa para guardarlos.',
    },
    lube: {
      label: '¿Qué lubricante debo usar?',
      answer:
        '**A base de agua:** seguro con todo.\n**A base de silicona:** dura más, pero **no lo uses con productos de silicona**.\n**A base de aceite:** nunca con látex.\n\nConsulta la página del producto para ver recomendaciones específicas.',
    },
    replace: {
      label: '¿Cuándo debo reemplazar un producto?',
      answer:
        'Reemplázalo ante cualquier signo de decoloración, olor, pegajosidad, roturas o grietas. La silicona de calidad puede durar años con el cuidado adecuado; otros materiales pueden necesitar reemplazo antes. En caso de duda, reemplázalo por seguridad.',
    },
  },
  'something-else': {
    label: 'Otra cosa',
    transition: 'De acuerdo, sin problema. ¿Cuál es tu pregunta?',
  },
};

// --- Traditional Chinese (Taiwan) -----------------------------------------
const TREE_ZH_HANT = {
  orders: {
    label: '訂單與追蹤',
    'track-order': {
      label: '我的訂單在哪裡？',
      answer:
        '您可以透過兩種方式查詢訂單：\n\n- 會員：[查看您的訂單](/account/orders)\n- 訪客結帳：使用[訂單追蹤](/track-order)，輸入您的訂單編號與結帳時使用的電子郵件\n\n快遞運送提供完整追蹤。免費與經濟型運送可能不含詳細追蹤資訊。',
    },
    'multiple-packages': {
      label: '我的訂單分成多個包裹寄送',
      answer:
        '這是正常的——我們從美國多個倉庫出貨，因此較大的訂單可能會分開包裹寄送。如果在預計送達時間結束後仍未收到所有商品，請[聯絡我們](/contact)並提供您的訂單編號。',
    },
    'cancel-order': {
      label: '取消我的訂單',
      answer:
        '訂單會在一天內陸續處理，因此我們僅能取消尚未出貨的訂單。請立即[聯絡我們](/contact)並提供您的訂單編號以嘗試取消。已出貨的包裹無法召回。',
    },
    'damaged-or-wrong': {
      label: '商品損壞或寄錯',
      answer:
        '很抱歉造成困擾——我們會為瑕疵商品退款或更換，並修正任何出貨錯誤。請[聯絡我們](/contact)並提供：\n\n- 您的訂單編號\n- 簡短的問題說明\n- 損壞的照片\n- 請保留所有包裝材料',
    },
  },
  shipping: {
    label: '運送與配送',
    'shipping-times': {
      label: '運送需要多久？',
      answer:
        '運送時間依方案而異——結帳時每個選項旁與您的收據上都會顯示預估時間。所有時間皆以工作天計算（不含週末與假日），依 UPS/USPS 的預估為準。詳情請見[運送與退貨](/shipping-returns)。',
    },
    international: {
      label: '你們有國際運送嗎？',
      answer:
        '有的——我們運送至全球許多國家。國際運送選項與預估時間會在結帳時顯示。若您的國際訂單未在預估時間內送達，我們將補足升級至下一級運送方案的差額。',
    },
    discreet: {
      label: '包裝隱密嗎？',
      answer:
        '是的。所有商品皆以樸素、無標示的包裝寄送，外觀不會顯示內容物。寄件人會顯示為 **CNV** 或 **TMQ**。國際海關申報時，商品會申報為「Health Equipment」、「Cosmetic」或「Gift」。詳情請見[運送與退貨頁面](/shipping-returns)。',
    },
    'tracking-number': {
      label: '我會收到追蹤號碼嗎？',
      answer:
        '快遞運送包含完整追蹤。免費與經濟型運送可能不含詳細追蹤。您隨時可透過[您的帳戶](/account/orders)或[訂單追蹤](/track-order)查詢狀態。',
    },
    'billing-statement': {
      label: '我的帳單上會顯示什麼名稱？',
      answer:
        '消費項目會在您的金融卡或信用卡帳單上顯示為 **TMQ LLC**。我們絕不會在帳單上透露購買的內容。',
    },
  },
  returns: {
    label: '退貨與退款',
    'return-policy': {
      label: '你們的退貨政策是什麼？',
      answer:
        '基於衛生考量，**所有商品一經售出概不退換**。我們僅在下列情況提供退款或更換：\n\n- 寄送錯誤的商品\n- 送達時即已損壞的商品\n\n請儘速檢查商品。完整政策請見[運送與退貨](/shipping-returns)。',
    },
    'damaged-return': {
      label: '我的商品送達時已損壞',
      answer:
        '我們會退款或更換。請[聯絡我們](/contact)並提供您的訂單編號與損壞照片，並請保留所有包裝材料。',
    },
    'bounced-package': {
      label: '我的包裹被拒收或退回',
      answer:
        '遭退回、無法投遞或被拒收的包裹須收取 10% 的重新上架費。已寄出商品的運費恕不退還。',
    },
  },
  payment: {
    label: '付款與帳務',
    'payment-methods': {
      label: '你們接受哪些付款方式？',
      answer:
        '所有主要信用卡（Visa、MasterCard、American Express、Discover）、Apple Pay 與 Google Pay——全部透過我們採用 Stripe 技術的結帳系統。',
    },
    'payment-plans': {
      label: '你們有提供分期付款嗎？',
      answer:
        '有的——符合條件的訂單可在結帳時使用 Afterpay 與 Klarna，讓您將消費分成無息分期付款。它們會在結帳過程中自動顯示。',
    },
    declined: {
      label: '我的付款遭拒',
      answer:
        '常見原因：卡片資訊有誤、餘額不足，或您銀行的防詐欺機制。請確認您的資料後再試一次，或致電您的銀行。若問題持續發生，請[聯絡我們](/contact)。',
    },
    'international-currency': {
      label: '你們接受外幣嗎？',
      answer:
        '接受。價格以美元（USD）標示；您的銀行會依其匯率以您的當地貨幣扣款，並可能加收國際交易手續費——詳情請洽您的銀行。',
    },
    'payment-secure': {
      label: '我的付款資訊安全嗎？',
      answer:
        '安全。我們採用業界標準的 SSL 加密，且所有付款處理皆由 Stripe 負責（符合 PCI 規範）。我們絕不會在伺服器上儲存您完整的信用卡資訊。',
    },
  },
  account: {
    label: '帳戶與登入',
    'reset-password': {
      label: '我忘記密碼了',
      answer:
        '前往[忘記密碼](/forgot-password)，輸入您的電子郵件，我們會寄送重設連結。若幾分鐘內未收到，請檢查您的垃圾郵件匣。',
    },
    'need-account': {
      label: '我需要註冊帳戶嗎？',
      answer:
        '不需要——訪客結帳也完全沒問題。註冊帳戶可享有訂單紀錄、已儲存的地址、願望清單，以及更便利的追蹤功能。如需註冊，請[在此註冊](/register)。',
    },
    coupon: {
      label: '如何使用優惠碼？',
      answer:
        '在[購物車頁面](/cart)或結帳時的欄位輸入優惠碼，然後點選**套用**。每筆訂單僅限使用一組優惠碼。',
    },
  },
  'product-help': {
    label: '尋找商品／推薦',
    'audience-male': {
      label: '男性適用',
      'cock-rings': { label: '屌環' },
      prostate: { label: '前列腺按摩器' },
      masturbators: { label: '自慰套與飛機杯' },
      'penis-pumps': { label: '陰莖幫浦' },
      sleeves: { label: '套筒與延長套' },
    },
    'audience-female': {
      label: '女性適用',
      'clit-vibes': { label: '陰蒂按摩器' },
      gspot: { label: 'G點玩具' },
      rabbits: { label: '兔子按摩棒' },
      suction: { label: '吸吮／空氣脈衝' },
      wands: { label: '魔杖按摩器' },
    },
    'audience-universal': {
      label: '通用／情侶',
      anal: { label: '後庭玩具' },
      dildos: { label: '假陽具' },
      bondage: { label: '綑綁與 BDSM' },
      strapons: { label: '穿戴式假陽具與綁帶' },
      lube: { label: '潤滑液' },
      condoms: { label: '保險套' },
    },
  },
  care: {
    label: '商品保養與相容性',
    cleaning: {
      label: '我該如何清潔商品？',
      answer:
        '大多數商品：每次使用前後以溫水與溫和的抗菌肥皂（或專用的玩具清潔劑）清洗。請務必查看商品的個別說明，並避免使用刺激性化學藥劑。',
    },
    storage: {
      label: '我該如何收納商品？',
      answer:
        '存放於陰涼乾燥、避免陽光直射處。矽膠製品請分開存放（可能與其他材質產生反應）。避免使用塑膠袋——容易積聚濕氣。許多商品都附有收納袋。',
    },
    lube: {
      label: '我該使用哪種潤滑液？',
      answer:
        '**水性：**與所有材質都安全相容。\n**矽性：**較持久，但**請勿與矽膠製品一起使用**。\n**油性：**切勿與乳膠一起使用。\n\n具體建議請查看商品頁面。',
    },
    replace: {
      label: '何時該更換商品？',
      answer:
        '一旦出現變色、異味、發黏、破損或裂痕等任何跡象，就應更換。優質矽膠在妥善保養下可使用多年；其他材質可能需要更早更換。若有疑慮，為安全起見請更換。',
    },
  },
  'something-else': {
    label: '其他問題',
    transition: '好的，沒問題。請問您的問題是什麼呢？',
  },
};

function injectTree(localeFile: string, tree: Record<string, unknown>) {
  const path = join(MESSAGES_DIR, localeFile);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data.chat) throw new Error(`${localeFile}: missing "chat" namespace`);
  data.chat.tree = tree;
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Injected chat.tree → ${localeFile}`);
}

injectTree('es.json', TREE_ES);
injectTree('zh-hant.json', TREE_ZH_HANT);
console.log('\nDone. Now run: bun scripts/convert-zh-hant-to-hans.ts');
