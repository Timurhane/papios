import {
  Activity,
  BarChart3,
  Boxes,
  CalendarClock,
  FileSignature,
  FolderKanban,
  Inbox,
  Link2,
  Map,
  MonitorPlay,
  NotebookPen,
  PenTool,
  Settings,
  Sun,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface PanelModule {
  path: string;
  label: string;
  description: string;
  phase: number;
  icon: LucideIcon;
}

/** Panel modules (K-13.2). Client portal is not listed: it lives behind a feature flag. */
export const panelModules: PanelModule[] = [
  {
    path: '/',
    label: 'Bugün',
    description:
      'Onay bekleyenler, tek tık kuyruğu, sıcak cevaplar, bugünün aramaları ve kota durumu.',
    phase: 2,
    icon: Sun,
  },
  {
    path: '/crm',
    label: 'CRM',
    description: 'Firmalar, kişiler, aşamalar; puan, analiz ve sıradaki adım.',
    phase: 2,
    icon: Users,
  },
  {
    path: '/gelen-kutusu',
    label: 'Gelen kutusu',
    description: 'Tüm kanallardan gelen cevaplar, sınıflandırma ve taslak cevaplar.',
    phase: 3,
    icon: Inbox,
  },
  {
    path: '/playbooklar',
    label: "Playbook'lar",
    description: 'Takip dizileri, adım bazında performans ve öneriler.',
    phase: 3,
    icon: Workflow,
  },
  {
    path: '/harita',
    label: 'Harita',
    description: 'Adaylar puan ve aşamaya göre; günlük ziyaret rotası.',
    phase: 6,
    icon: Map,
  },
  {
    path: '/rutinler',
    label: 'Rutinler',
    description: 'Hazır rutinler ve doğal dille yeni rutin oluşturma.',
    phase: 6,
    icon: CalendarClock,
  },
  {
    path: '/teklifler',
    label: 'Teklif stüdyosu',
    description: 'Paketlerden teklif, iki ödeme yolu, kurucu indirimi, PDF.',
    phase: 4,
    icon: FileSignature,
  },
  {
    path: '/demolar',
    label: 'Kişiye özel demo',
    description: 'İşletmeye özel 14 günlük sohbet asistanı demoları.',
    phase: 4,
    icon: MonitorPlay,
  },
  {
    path: '/projeler',
    label: 'Projeler',
    description: 'Kazanılan müşterilerin kurulum ve teslim işleri.',
    phase: 5,
    icon: FolderKanban,
  },
  {
    path: '/teslim-modulleri',
    label: 'Teslim modülleri',
    description: 'Hazır modüller, kurulum formu ve Claude Code kurulum promptu.',
    phase: 5,
    icon: Boxes,
  },
  {
    path: '/finans',
    label: 'Finans',
    description: 'Gelir-gider, abonelikler, tahsilat ve aylık yinelenen gelir.',
    phase: 5,
    icon: Wallet,
  },
  {
    path: '/notlar',
    label: 'Notlar',
    description: 'Fikirler, toplantı ve sesli notlar; aranabilir.',
    phase: 5,
    icon: NotebookPen,
  },
  {
    path: '/icerik',
    label: 'İçerik',
    description: 'Kalem: haftalık içerik planı ve taslaklar.',
    phase: 6,
    icon: PenTool,
  },
  {
    path: '/olcutler',
    label: 'Ölçütler',
    description: 'Gelir, huni, müşteri ve sistem sağlığı.',
    phase: 6,
    icon: BarChart3,
  },
  {
    path: '/baglantilar',
    label: 'Bağlantılar',
    description: 'Mail, takvim, Instagram, Telegram ve kapalı adaptörler.',
    phase: 1,
    icon: Link2,
  },
  {
    path: '/yapilanlar',
    label: 'Yapılanlar',
    description: 'Tüm eylemlerin değiştirilemez kaydı.',
    phase: 1,
    icon: Activity,
  },
  {
    path: '/ayarlar',
    label: 'Ayarlar',
    description: 'Ton, fiyatlar, iş saatleri, limitler, puanlama, LLM yönlendirme ve daha fazlası.',
    phase: 1,
    icon: Settings,
  },
];
