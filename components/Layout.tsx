"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/providers/AuthProvider";
import { useNotifications } from "@/lib/hooks/useNotifications";
import Modal from "@/components/Modal";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, adminUser, signOut, loading } = useAuth();
  const pathname = usePathname();
  
  const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

  const navigation = [
    { name: "Dashboard", href: "/dashboard", roles: ["viewer", "editor", "ops", "admin"] },
    { name: "Products", href: "/products", roles: ["ops", "admin"] },
    { name: "Designs", href: "/designs", roles: ["ops", "admin"] },
    { name: "Blanks", href: "/blanks", roles: ["ops", "admin"] },
    { name: "Review", href: "/review", roles: ["ops", "admin", "editor"] },
    { name: "Inspirations", href: "/inspirations", roles: ["ops", "admin", "editor"] },
    { name: "Analytics", href: "/analytics", roles: ["ops", "admin"] },
    { name: "Leagues", href: "/leagues", roles: ["editor", "admin"] },
    { name: "Teams", href: "/teams", roles: ["editor", "admin"] },
    { name: "LoRA Ops", href: "/lora", roles: ["ops", "admin"] },
  ];

  const loraNav = [
    { name: "Packs", href: "/lora/packs" },
    { name: "Identities", href: "/lora/identities" },
    { name: "Reference Library", href: "/lora/references" },
    { name: "Datasets", href: "/lora/datasets" },
    { name: "Training Jobs", href: "/lora/training" },
  ];

  const canAccess = (roles: string[]) => {
    // If we have a user but adminUser is not loaded yet, show navigation optimistically
    // This prevents the menu from disappearing while admin data is being fetched
    if (!adminUser) {
      // Show menu optimistically if we have a user (admin fetch might still be in progress)
      // This way menu appears immediately and updates when adminUser loads
      return !!user;
    }
    return roles.includes(adminUser.role);
  };

  const showLoRANav = pathname?.startsWith("/lora");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold mr-8 text-gray-900">Rally Panties DesignOps</h1>
              <nav className="flex space-x-4">
                {navigation.map((item) => {
                  if (!canAccess(item.roles)) return null;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`px-3 py-2 rounded-md text-sm font-medium ${
                        isActive(item.href)
                          ? "bg-blue-100 text-blue-700"
                          : "text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {item.name}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <NotificationsBell />
              <span className="text-sm text-gray-700">
                {adminUser?.email} ({adminUser?.role})
              </span>
              <button
                onClick={signOut}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
              >
                Sign Out
              </button>
            </div>
          </div>
          {showLoRANav && (
            <div className="border-t border-gray-200">
              <nav className="flex space-x-4 px-4">
                {loraNav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-2 border-b-2 text-sm font-medium ${
                      isActive(item.href)
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-gray-700 hover:text-gray-900 hover:border-gray-300"
                    }`}
                  >
                    {item.name}
                  </Link>
                ))}
              </nav>
            </div>
          )}
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}

function NotificationsBell() {
  const [isOpen, setIsOpen] = useState(false);
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const router = useRouter();  const handleNotificationClick = (notification: any) => {
    if (notification.id) {
      markAsRead(notification.id);
    }
    setIsOpen(false);
    
    // Navigate based on notification type
    if (notification.relatedProductId) {
      // Need to get product slug first, or navigate to products list
      router.push(`/products`);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-700 hover:bg-gray-100 rounded-lg"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 block h-4 w-4 rounded-full bg-red-600 text-white text-xs flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  Mark all as read
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  No notifications
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                        !notification.read ? "bg-blue-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">
                            {notification.title}
                          </p>
                          <p className="text-xs text-gray-600 mt-1">
                            {notification.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {notification.createdAt?.toDate?.().toLocaleString() || "Just now"}
                          </p>
                        </div>
                        {!notification.read && (
                          <div className="ml-2 h-2 w-2 bg-blue-600 rounded-full"></div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}