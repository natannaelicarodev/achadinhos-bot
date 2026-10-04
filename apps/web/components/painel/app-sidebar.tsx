"use client";

import {
  BarChart3Icon,
  CalendarClockIcon,
  HomeIcon,
  LogOutIcon,
  RadioTowerIcon,
  SettingsIcon,
  ShoppingBagIcon,
  TagIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { logoutAction } from "@/lib/auth/actions";

export const MENU = [
  { title: "Início", href: "/painel", icon: HomeIcon },
  { title: "Canais", href: "/painel/canais", icon: RadioTowerIcon },
  { title: "Catálogo", href: "/painel/catalogo", icon: ShoppingBagIcon },
  { title: "Ofertas", href: "/painel/ofertas", icon: TagIcon },
  { title: "Agendamento", href: "/painel/agendamento", icon: CalendarClockIcon },
  { title: "Relatórios", href: "/painel/relatorios", icon: BarChart3Icon },
  { title: "Configurações", href: "/painel/configuracoes", icon: SettingsIcon },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/painel" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ tenantName, userName }: { tenantName: string; userName: string }) {
  const pathname = usePathname();
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-2 py-1.5">
          <p className="text-sm font-semibold">Achadinhos Bot</p>
          <p className="truncate text-xs text-muted-foreground">{tenantName}</p>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {MENU.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(pathname, item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="truncate px-2 text-xs text-muted-foreground">{userName}</p>
        <form action={logoutAction}>
          <SidebarMenuButton type="submit">
            <LogOutIcon />
            <span>Sair</span>
          </SidebarMenuButton>
        </form>
      </SidebarFooter>
    </Sidebar>
  );
}
