import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChartCandlestick,
  Crosshair,
  CandlestickChart,
  GraduationCap,
  LayoutDashboard,
  ScanSearch,
  Settings,
  Users,
} from '@lucide/vue'
import type { Component } from 'vue'

export interface NavItem {
  to: string
  labelKey: string
  shortKey: string
  icon: Component
  primary?: boolean
}

export const navItems: NavItem[] = [
  { to: '/', labelKey: 'nav.lobby', shortKey: 'nav.lobbyShort', icon: LayoutDashboard, primary: true },
  { to: '/trainer', labelKey: 'nav.trainer', shortKey: 'nav.trainerShort', icon: ChartCandlestick, primary: true },
  { to: '/terminal', labelKey: 'nav.trade', shortKey: 'nav.tradeShort', icon: CandlestickChart, primary: true },
  { to: '/drill', labelKey: 'nav.drill', shortKey: 'nav.drillShort', icon: Crosshair, primary: true },
  { to: '/analysis', labelKey: 'nav.analysis', shortKey: 'nav.analysisShort', icon: ScanSearch, primary: true },
  // Daily moves into the mobile "More" sheet so the tab bar keeps room for Trade.
  { to: '/daily', labelKey: 'nav.daily', shortKey: 'nav.dailyShort', icon: CalendarDays },
  { to: '/pk', labelKey: 'nav.pk', shortKey: 'nav.pkShort', icon: Users },
  { to: '/stats', labelKey: 'nav.stats', shortKey: 'nav.statsShort', icon: BarChart3, primary: true },
]

export const secondaryNavItems: NavItem[] = [
  { to: '/learn', labelKey: 'nav.academy', shortKey: 'nav.academyShort', icon: GraduationCap },
  { to: '/guide', labelKey: 'nav.guide', shortKey: 'nav.guideShort', icon: BookOpen },
  { to: '/settings', labelKey: 'nav.settings', shortKey: 'nav.settingsShort', icon: Settings },
]

export const mobileNavItems: NavItem[] = navItems.filter((item) => item.primary)

export function isActivePath(path: string, to: string) {
  return to === '/' ? path === '/' : path.startsWith(to)
}
