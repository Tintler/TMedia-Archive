/* =====================================================================
   1000Kitap → CSV   (sürüm 2)
   ---------------------------------------------------------------------
   İki tuzak var:
     • Liste sayfasında 10 kitap vardır ama ham HTML'de yalnızca 6'sı bulunur;
       kalanını sayfanın kendi JavaScript'i yerleştirir. Bu yüzden listeler
       AYRI BİR SEKMEDE açılır: sayfa normal şekilde kurulur, kitaplar
       yerine oturana kadar beklenir, sonra okunur. Sekme kendiliğinden
       sayfadan sayfaya geçer; iş bitince kapanır.
     • Site dakikada belli sayıda istek kabul eder; fazlasına HTTP 429 der.
       Betik 429 görünce bekleyip yeniden dener ve kendini yavaşlatır.
   Okunan kitap sayfaları tarayıcıda saklanır; yarıda kalırsa ikinci
   çalıştırma kaldığı yerden devam eder.

   NASIL ÇALIŞTIRILIR
     1. Tarayıcıda 1000kitap.com'u aç.
     2. F12 ▸ Console  (Mac'te Cmd+Option+J).
        "Yapıştırmaya izin ver" uyarısı çıkarsa konsola şunu YAZ (yapıştırma):
              allow pasting
        ve Enter'a bas. Sonra betiği yapıştır.
     3. Aşağıdaki KULLANICI satırını kendi adınla değiştir.
     4. Tümünü yapıştır, Enter. Konsolu izle.
     5. Bitince CSV kendiliğinden iner.

   YARIDA KALIRSA
     Betiği aynen tekrar çalıştır. Daha önce okuduğu kitap sayfalarını
     yeniden istemez, yalnızca eksikleri tamamlar.

   KOMUTLAR (iş bittikten sonra konsolda)
     tekrarDene()     — alınamayan kitap sayfalarını yeniden dener
     onbellegiSil()   — saklanan kitap bilgilerini siler, sıfırdan başlar

   AÇILAN SEKMEYE DOKUNMA
     Betik o sekmeyi kendisi gezdirir. Engellenirse tarayıcı "açılır pencere
     engellendi" der — 1000kitap.com için açılır pencerelere izin ver ve
     betiği yeniden çalıştır.
   ===================================================================== */

(async function () {
  'use strict';

  /* ------------------------- AYARLAR ------------------------------- */
  const KULLANICI   = 'Whiteshade';   // ← profil adresindeki ad
  const DETAY_AL    = true;           // sayfa sayısı, yayınevi, ISBN, kapak
  const BEKLE       = 1100;           // istekler arası temel bekleme (ms)
  const EN_FAZLA_SAYFA = 400;
  const SEKME_BEKLE = 1500;           // sayfa oturduktan sonra ek bekleme (ms)
  const SEKME_SURE  = 30000;          // bir sayfa için en fazla bekleme (ms)

  /* Raf adresleri. Bulunamayanlar sessizce atlanır. */
  const RAFLAR = [
    {slug:'okuduklari',        durum:'Completed'},
    {slug:'suAndaOkuduklari',  durum:'Reading'},
    {slug:'suAnOkuduklari',    durum:'Reading'},
    {slug:'okuyacaklari',      durum:'Plan to read'},
    {slug:'yarimBiraktiklari', durum:'Dropped'}
  ];

  /* ------------------------- TEMEL ARAÇLAR ------------------------- */
  const bekle = ms => new Promise(r => setTimeout(r, ms));
  const duz = s => String(s || '').replace(/\s+/g, ' ').trim();
  const AYLAR = {oca:1, şub:2, sub:2, mar:3, nis:4, may:5, haz:6,
                 tem:7, ağu:8, agu:8, eyl:9, eki:10, kas:11, ara:12};
  /* Ay adına sabitlenmiş kalıp. Yoksa "Kitap 0 Yazar 0" gibi metinlerde
     "0 Yaz" tarih sanılıyor. */
  const TARIH_RE = /(\d{1,2})\s+(Oca|Şub|Sub|Mar|Nis|May|Haz|Tem|Ağu|Agu|Eyl|Eki|Kas|Ara)[a-zçğıöşü]*\.?\s*(\d{4})?/i;

  let araBekleme = BEKLE;      // 429 görülünce büyür, işler yolundaysa küçülür
  let ustUsteIyi = 0;
  let toplamIstek = 0, toplam429 = 0;

  /* Tek bir istek; 429'a takılırsa bekleyip yeniden dener. */
  async function iste(url, deneme) {
    deneme = deneme || 0;
    toplamIstek++;
    const res = await fetch(url, {credentials: 'include'});

    if (res.status === 429) {
      toplam429++;
      if (deneme >= 4) throw new Error('429 — site istekleri sınırlıyor');
      const basliktan = parseInt(res.headers.get('Retry-After') || '', 10);
      const sure = basliktan ? basliktan * 1000 : [8000, 20000, 45000, 90000][deneme];
      araBekleme = Math.min(4000, Math.round(araBekleme * 1.5));   // kalıcı olarak yavaşla
      ustUsteIyi = 0;
      console.warn('    429 — ' + Math.round(sure / 1000) + ' sn bekleyip yeniden denenecek ' +
                   '(bundan sonra istekler arası ' + araBekleme + ' ms)');
      await bekle(sure);
      return iste(url, deneme + 1);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);

    /* Uzun süre sorun çıkmadıysa biraz hızlanmayı dene. */
    if (++ustUsteIyi >= 15 && araBekleme > BEKLE) {
      araBekleme = Math.max(BEKLE, Math.round(araBekleme * 0.8));
      ustUsteIyi = 0;
    }
    return res.text();
  }

  async function sayfaAl(url) {
    return new DOMParser().parseFromString(await iste(url), 'text/html');
  }

  /* ---------------- LİSTE SEKMESİ ----------------
     Listeler ayrı bir sekmede açılır. Sayfa gerçek bir sekmede kurulduğu
     için JavaScript'in yerleştirdiği kayıtlar da oluşur. */
  let sekme = null;

  function sekmeAc() {
    sekme = window.open('about:blank', '1kexport', 'width=1100,height=850');
    if (!sekme) throw new Error(
      'Açılır pencere engellendi. 1000kitap.com için izin verip betiği yeniden çalıştır.');
    return sekme;
  }
  function sekmeKapat() { try { if (sekme && !sekme.closed) sekme.close(); } catch (e) {} }

  const kitapSayisi = d => d.querySelectorAll('a[href*="/kitap/"]').length;
  const ilkKitap = function (d) {
    const a = d.querySelector('a[href*="/kitap/"]');
    return a ? a.getAttribute('href') : '';
  };

  /* Sekmeyi verilen adrese götürür ve sayfa oturana kadar bekler:
     kayıt sayısı üst üste sabit kalınca hazır sayılır. */
  /* Son okunan sayfanın ilk kitabı. Raflar arasında da taşınır ki sekme
     yeni adrese geçmeden önceki sayfayı okumayalım. */
  let sonIlkKitap = '';

  async function sekmeyeGit(url) {
    if (!sekme || sekme.closed) sekmeAc();
    sekme.location.href = url;

    const basla = Date.now();
    let sonSayi = -1, sabit = 0, bos = 0;
    while (Date.now() - basla < SEKME_SURE) {
      await bekle(400);
      let d;
      try { d = sekme.document; } catch (e) { continue; }
      if (!d || d.readyState !== 'complete' || !d.body) { sabit = 0; continue; }

      const ilk = ilkKitap(d);
      /* Hâlâ önceki sayfadaysak sayma. */
      if (sonIlkKitap && ilk && ilk === sonIlkKitap) { sabit = 0; continue; }

      const n = kitapSayisi(d);
      if (n === 0) {
        /* Boş raf ya da bulunmayan adres: birkaç yoklamadan sonra kabul et. */
        if (++bos >= 5) { sonIlkKitap = ''; return d; }
        continue;
      }
      bos = 0;
      if (n === sonSayi) sabit++; else sabit = 0;
      sonSayi = n;

      if (sabit >= 2) {
        try { sekme.scrollTo(0, d.body.scrollHeight); } catch (e) {}
        await bekle(SEKME_BEKLE);
        const son = sekme.document;
        sonIlkKitap = ilkKitap(son);
        return son;
      }
    }
    throw new Error('sayfa zamanında kurulmadı');
  }

  function tarihCevir(metin) {
    const m = duz(metin).match(TARIH_RE);
    if (!m) return '';
    const gun = +m[1], ay = AYLAR[m[2].toLowerCase()];
    if (!ay) return '';
    let yil = m[3] ? +m[3] : new Date().getFullYear();
    const iso = y => y + '-' + String(ay).padStart(2, '0') + '-' + String(gun).padStart(2, '0');
    if (!m[3] && new Date(iso(yil)) > new Date()) yil -= 1;
    return iso(yil);
  }

  /* ------------------------- ÖNBELLEK ------------------------------ */
  const ONB = '1kdetay:';
  function onbellekOku(id) {
    try { const v = localStorage.getItem(ONB + id); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  }
  function onbellekYaz(id, veri) {
    try { localStorage.setItem(ONB + id, JSON.stringify(veri)); } catch (e) {}
  }
  window.onbellegiSil = function () {
    let n = 0;
    Object.keys(localStorage).forEach(function (k) {
      if (k.indexOf(ONB) === 0) { localStorage.removeItem(k); n++; }
    });
    console.log(n + ' kitap bilgisi silindi.');
  };

  /* ------------------------- LİSTE SAYFASI ------------------------- */
  function listeOku(doc, durum) {
    const cikan = [], gorulen = new Set();
    doc.querySelectorAll('a[href*="/kitap/"]').forEach(function (a) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/kitap\/([^\/?#]+?)--(\d+)(?:$|[?#])/);
      if (!m) return;
      const baslik = duz(a.textContent);
      if (!baslik) return;
      const id = m[2];
      if (gorulen.has(id)) return;

      let kutu = a, adim = 0;
      while (kutu && adim < 8 && !kutu.querySelector('a[href*="/yazar/"]')) { kutu = kutu.parentElement; adim++; }
      if (!kutu) return;

      const yazarA = kutu.querySelector('a[href*="/yazar/"]');
      const metin = duz(kutu.textContent);
      const puanim = metin.match(/(\d+(?:[.,]\d+)?)\s*\/\s*10\s*puan verdi/);
      const siteler = metin.match(/(\d+(?:[.,]\d+)?)\s*\/\s*10/);
      const sure = metin.match(/(\d+)\s*(gün|saat|dakika)\w*\s*okudu/);

      gorulen.add(id);
      cikan.push({
        'Book Id': id,
        'Title': baslik,
        'Author': yazarA ? duz(yazarA.textContent) : '',
        'Translator': '',
        'Publisher': '',
        'ISBN': '',
        'Pages': '',
        'First Published': '',
        'Genres': '',
        'Site Rating': siteler ? siteler[1].replace(',', '.') : '',
        'My Rating': puanim ? puanim[1].replace(',', '.') : '',
        'Shelf': durum,
        'Date Read': tarihCevir(metin),
        'Reading Time': sure ? sure[1] + ' ' + sure[2] : '',
        'URL': 'https://1000kitap.com/kitap/' + m[1] + '--' + id,
        'Cover': ''
      });
    });
    return cikan;
  }

  function sonrakiVar(doc) {
    return Array.from(doc.querySelectorAll('a')).some(function (a) {
      return /(^|\s)İleri(\s|$)/.test(duz(a.textContent)) &&
             /sayfa=\d+/.test(a.getAttribute('href') || '');
    });
  }

  /* Raf başlığındaki "120 kitap" — sonunda karşılaştırmak için. */
  function beklenenSayi(doc) {
    const m = duz(doc.body ? doc.body.textContent : '').match(/(\d[\d.]*)\s*kitap/);
    return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
  }

  /* ------------------------- KİTAP SAYFASI ------------------------- */
  const ETIKETLER = ['Tahmini Okuma Süresi','Sayfa Sayısı','Basım Tarihi','İlk Yayın Tarihi',
                     'Yayınevi','Orijinal Adı','ISBN','Ülke','Dil','Format','Türler','Sıralamalar'];

  function alan(metin, etiket) {
    const digerleri = ETIKETLER.filter(function (e) { return e !== etiket; })
      .map(function (e) { return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
    const m = metin.match(new RegExp(etiket + ':\\s*(.*?)(?=(?:' + digerleri + '):|$)'));
    return m ? duz(m[1]) : '';
  }

  async function detayAl(kitap) {
    const saklanan = onbellekOku(kitap['Book Id']);
    if (saklanan) { Object.assign(kitap, saklanan); return 'önbellek'; }

    const doc = await sayfaAl(kitap.URL);
    const meta = function (ad) {
      const el = doc.querySelector('meta[property="' + ad + '"], meta[name="' + ad + '"]');
      return el ? el.getAttribute('content') || '' : '';
    };
    const govde = duz(doc.body ? doc.body.textContent : '');
    const sayfa = alan(govde, 'Sayfa Sayısı').match(/\d[\d.]*/);
    const yil = alan(govde, 'İlk Yayın Tarihi').match(/\d{4}/);
    let isbn = (meta('book:isbn') || '').replace(/[^0-9Xx]/g, '');
    if (!isbn) { const mi = alan(govde, 'ISBN').match(/[\dXx]{10,13}/); isbn = mi ? mi[0] : ''; }
    const turler = Array.from(doc.querySelectorAll('a[href*="/kitap-turu/"]'))
      .map(function (a) { return duz(a.textContent); }).filter(Boolean);
    const cev = govde.match(/Çevirmen:\s*([^:]{2,60}?)(?=\s{2,}|Yazarlar:|Takip|$)/);

    const veri = {
      'Cover': meta('og:image') || '',
      'ISBN': isbn,
      'Pages': sayfa ? sayfa[0].replace(/\./g, '') : '',
      'Publisher': alan(govde, 'Yayınevi').slice(0, 80),
      'First Published': yil ? yil[0] : '',
      'Genres': Array.from(new Set(turler)).join(', '),
      'Translator': cev ? duz(cev[1]).slice(0, 60) : ''
    };
    onbellekYaz(kitap['Book Id'], veri);
    Object.assign(kitap, veri);
    return 'yeni';
  }

  /* ------------------------- CSV ----------------------------------- */
  function csvYap(satirlar) {
    const basliklar = Object.keys(satirlar[0]);
    const hucre = function (v) {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '\uFEFF' + [basliklar.join(',')]
      .concat(satirlar.map(function (r) {
        return basliklar.map(function (h) { return hucre(r[h]); }).join(',');
      })).join('\n');
  }
  function indir(metin, ad) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([metin], {type: 'text/csv;charset=utf-8'}));
    a.download = ad;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ------------------------- ANA AKIŞ ------------------------------ */
  console.log('%c1000Kitap → CSV (sürüm 2)', 'font-weight:bold;font-size:14px');
  console.log('Kullanıcı:', KULLANICI, '· istekler arası', BEKLE, 'ms');

  const hepsi = [];
  const rafOzet = [];

  try { sekmeAc(); } catch (err) { console.error(err.message); return; }
  console.log('Listeler yan sekmede geziliyor — o sekmeye dokunma.');

  for (const raf of RAFLAR) {
    let sayfa = 1, rafToplam = 0, beklenen = null, yarimKaldi = false;

    while (sayfa <= EN_FAZLA_SAYFA) {
      const url = 'https://1000kitap.com/' + KULLANICI + '/kitaplari/' + raf.slug +
                  (sayfa > 1 ? '?sayfa=' + sayfa : '');
      let paket;
      try {
        const doc = await sekmeyeGit(url);
        paket = {
          kitaplar: listeOku(doc, raf.durum),
          devam: sonrakiVar(doc),
          sayi: beklenenSayi(doc)
        };
      } catch (err) {
        if (sayfa === 1) {
          console.log('  ' + raf.slug + ': kitap yok (' + err.message + ')');
        } else {
          yarimKaldi = true;
          console.error('  ' + raf.slug + ' · sayfa ' + sayfa + ' alınamadı (' + err.message +
                        ') — bu raf yarım kaldı, betiği tekrar çalıştır');
        }
        break;
      }

      if (sayfa === 1) beklenen = paket.sayi;

      const bulunan = paket.kitaplar;
      if (!bulunan.length) break;

      hepsi.push.apply(hepsi, bulunan);
      rafToplam += bulunan.length;
      console.log('  ' + raf.slug + ' · sayfa ' + sayfa + ' · ' + bulunan.length +
                  ' kitap (toplam ' + rafToplam + ')');

      if (!paket.devam) break;
      sayfa++;
      await bekle(600);
    }

    if (rafToplam) {
      rafOzet.push({
        raf: raf.slug, alinan: rafToplam, sayfada: beklenen,
        sayfa: sayfa, sayfaBasi: Math.round(rafToplam / Math.max(1, sayfa)), yarim: yarimKaldi
      });
      const uyari = (beklenen && beklenen !== rafToplam) ? ' ⚠ sayfada ' + beklenen + ' yazıyor' : '';
      console.log('%c' + raf.slug + ': ' + rafToplam + ' kitap' + uyari, 'color:#2a7;font-weight:bold');
      if (beklenen && rafToplam < beklenen) {
        console.warn('    Sayfa başına ' + Math.round(rafToplam / Math.max(1, sayfa)) + ' kitap alındı; ' +
          'sayfada 10 olmalı. SEKME_BEKLE değerini büyütüp (3000) tekrar dene.');
      }
    }
  }

  /* Aynı kitap birden çok rafta görünürse ilki kalsın. */
  const kitaplar = [];
  const gorulen = new Set();
  hepsi.forEach(function (k) {
    if (!gorulen.has(k['Book Id'])) { gorulen.add(k['Book Id']); kitaplar.push(k); }
  });

  sekmeKapat();

  if (!kitaplar.length) {
    console.error('Hiç kitap bulunamadı. KULLANICI adını kontrol et.');
    return;
  }
  console.log('%cListeler bitti: ' + kitaplar.length + ' kitap', 'font-weight:bold');

  /* --------- kitap sayfaları --------- */
  const basarisiz = [];
  if (DETAY_AL) {
    console.log('Kitap sayfaları okunuyor…');
    let yeni = 0, onbellekten = 0;
    for (let i = 0; i < kitaplar.length; i++) {
      try {
        const nasil = await detayAl(kitaplar[i]);
        if (nasil === 'yeni') { yeni++; await bekle(araBekleme); }
        else onbellekten++;
      } catch (err) {
        basarisiz.push(kitaplar[i]);
        console.warn('    alınamadı: ' + kitaplar[i].Title + ' — ' + err.message);
        await bekle(araBekleme);
      }
      if ((i + 1) % 20 === 0 || i === kitaplar.length - 1) {
        console.log('  ' + (i + 1) + '/' + kitaplar.length + ' · yeni ' + yeni +
                    ' · önbellekten ' + onbellekten + ' · alınamayan ' + basarisiz.length);
      }
    }
  }

  /* --------- CSV --------- */
  const bugun = new Date().toISOString().slice(0, 10);
  indir(csvYap(kitaplar), '1000kitap_' + KULLANICI + '_' + bugun + '.csv');

  console.log('%c——— ÖZET ———', 'font-weight:bold');
  console.table(rafOzet);
  console.log('Kitap: ' + kitaplar.length + ' · istek: ' + toplamIstek +
              ' · 429: ' + toplam429 + ' · son hız: ' + araBekleme + ' ms');
  if (basarisiz.length) {
    console.warn(basarisiz.length + ' kitabın sayfası okunamadı (sayfa sayısı ve kapak eksik).');
    console.warn('Bir iki dakika bekle, sonra konsola  tekrarDene()  yazıp Enter\'a bas.');
  }
  if (rafOzet.some(function (r) { return r.yarim || (r.sayfada && r.sayfada !== r.alinan); })) {
    console.warn('Bazı raflar eksik kaldı. Birkaç dakika sonra betiği baştan çalıştır; ' +
                 'okunmuş kitap sayfaları önbellekte olduğu için hızlı bitecek.');
  }
  console.log('%cCSV indirildi.', 'color:#2a7;font-weight:bold');

  window.kitaplarim = kitaplar;

  /* Eksik kalanları sonradan tamamla, CSV'yi yeniden indir. */
  window.tekrarDene = async function () {
    const kalan = kitaplar.filter(function (k) {
      return !k.Pages && !onbellekOku(k['Book Id']);
    });
    if (!kalan.length) { console.log('Eksik kalmamış.'); return; }
    console.log(kalan.length + ' kitap yeniden deneniyor…');
    let tamam = 0;
    for (const k of kalan) {
      try { await detayAl(k); tamam++; }
      catch (err) { console.warn('  yine olmadı: ' + k.Title + ' — ' + err.message); }
      await bekle(araBekleme);
    }
    console.log(tamam + ' kitap tamamlandı, CSV yeniden iniyor.');
    indir(csvYap(kitaplar), '1000kitap_' + KULLANICI + '_' + bugun + '.csv');
  };
})();
