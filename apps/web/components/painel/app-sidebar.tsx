"use client";

import {
  BarChart3Icon,
  CalendarClockIcon,
  CreditCardIcon,
  HomeIcon,
  KeyRoundIcon,
  LinkIcon,
  LogOutIcon,
  PuzzleIcon,
  RadioTowerIcon,
  ReceiptIcon,
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
  { title: "Divulgar link", href: "/painel/divulgar-link", icon: LinkIcon },
  { title: "Credenciais", href: "/painel/credenciais", icon: KeyRoundIcon },
  { title: "Extensão", href: "/painel/extensao", icon: PuzzleIcon },
  { title: "Ofertas", href: "/painel/ofertas", icon: TagIcon },
  { title: "Agendamento", href: "/painel/agendamento", icon: CalendarClockIcon },
  { title: "Relatórios", href: "/painel/relatorios", icon: BarChart3Icon },
  { title: "Assinatura", href: "/painel/assinatura", icon: CreditCardIcon },
  { title: "Configurações", href: "/painel/configuracoes", icon: SettingsIcon },
] as const;

/** Só para as contas administradoras do sistema. */
const ADMIN_MENU = [{ title: "Cobranças (admin)", href: "/painel/admin/cobrancas", icon: ReceiptIcon }] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/painel" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({
  tenantName,
  userName,
  admin = false,
  reviewCount = 0,
}: {
  tenantName: string;
  userName: string;
  admin?: boolean;
  /** Cobranças para revisar (administrador). */
  reviewCount?: number;
}) {
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
              {[...MENU, ...(admin ? ADMIN_MENU : [])].map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(pathname, item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                    {item.href === "/painel/admin/cobrancas" && reviewCount > 0 ? (
                      <span
                        className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white"
                        aria-label={`${reviewCount} cobranças para revisar`}
                      >
                        {reviewCount}
                      </span>
                    ) : null}
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
