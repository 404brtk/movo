import type { ReactNode } from "react";
import { Toast } from "@base-ui/react/toast";
import { buttonVariants } from "./ui/button.tsx";

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="absolute right-0 bottom-0 w-full rounded-xl bg-popover text-popover-foreground shadow-popover transition-[opacity,translate] duration-200 ease-out data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0 motion-reduce:transition-none"
    >
      <Toast.Content className="flex items-center gap-3 py-2.5 pr-2.5 pl-4">
        <div className="min-w-0 flex-1">
          <Toast.Title className="text-[13px]/5 font-semibold" />
          <Toast.Description className="text-xs text-muted-foreground" />
        </div>
        <Toast.Action className={buttonVariants({ variant: "outline", size: "sm" })} />
      </Toast.Content>
    </Toast.Root>
  ));
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider limit={1}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed right-4 bottom-4 z-50 w-[calc(100vw-2rem)] sm:w-90">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
