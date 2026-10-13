/** All user-facing strings (K-0.5: UI is Turkish). */
export const tr = {
  appName: 'Papi',
  brand: 'AJNA Digital',
  tagline: 'AI. SYSTEMS. GROWTH. CREATIVE.',
  loading: 'Yükleniyor…',
  configMissing: {
    title: 'Yapılandırma eksik',
    body: 'Panelin Supabase adresi, herkese açık anahtarı ve izinli e-posta adresi tanımlı değil. apps/web/.env.example dosyasına bakın.',
  },
  login: {
    title: 'Giriş yap',
    subtitle: 'Yalnızca yetkili hesap giriş yapabilir.',
    email: 'E-posta',
    password: 'Şifre',
    submit: 'Devam et',
    submitting: 'Kontrol ediliyor…',
    invalid: 'E-posta veya şifre hatalı.',
    notAllowed: 'Bu hesabın panele erişim izni yok.',
  },
  enroll: {
    title: 'İki aşamalı doğrulamayı kur',
    subtitle:
      'Panele girmek için doğrulama uygulaması zorunludur. QR kodu Google Authenticator, 1Password veya benzeri bir uygulamayla okutun.',
    secretLabel: 'QR okutamıyorsanız bu anahtarı elle girin:',
    qrAlt: 'Doğrulama uygulaması için QR kod',
    preparing: 'QR kod hazırlanıyor…',
  },
  verify: {
    title: 'Doğrulama kodu',
    subtitle: 'Doğrulama uygulamanızdaki 6 haneli kodu girin.',
    code: '6 haneli kod',
    submit: 'Doğrula',
    submitting: 'Doğrulanıyor…',
    invalid: 'Kod hatalı veya süresi doldu. Tekrar deneyin.',
  },
  genericError: 'Bir şeyler ters gitti. Tekrar deneyin.',
  signOut: 'Çıkış yap',
  menu: 'Menü',
  closeMenu: 'Menüyü kapat',
  comingSoon: 'Yakında',
  comingSoonBody: (phase: number) => `Bu modül Faz ${phase} kapsamında geliyor.`,
  notFound: 'Sayfa bulunamadı.',
} as const;
